import { useState, useEffect, useRef, useCallback } from "react";
import { base44, supabase } from "@/api/base44Client";
import lamejs from "lamejs";
import { Send, CheckCircle2, AlertCircle, Loader2, RefreshCw, X, Mic, FileText, Trash2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ── BX24 bridge ─────────────────────────────────────────────────────────────

function loadBx24() {
  return new Promise((resolve) => {
    if (window.BX24) return resolve();
    const s = document.createElement("script");
    s.src = "https://api.bitrix24.com/api/v1/";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.body.appendChild(s);
  });
}

// ── Template body parser ─────────────────────────────────────────────────────

function parseBody(text) {
  const parts = [];
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
    parts.push({ kind: "var", idx: parseInt(m[1]) - 1 });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

// ── File picker — <label> works inside sandboxed iframes ────────────────────

function MediaPicker({ inputId, headerType, file, previewUrl, onChange, onClear }) {
  const isImage = headerType === "IMAGE";
  const label = headerType.charAt(0) + headerType.slice(1).toLowerCase();
  return (
    <div>
      <input
        id={inputId}
        type="file"
        className="sr-only"
        accept={isImage ? "image/*" : "*/*"}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          {isImage && previewUrl && (
            <img src={previewUrl} className="h-10 w-10 object-cover rounded" alt="preview" />
          )}
          <span className="text-xs truncate flex-1">{file.name}</span>
          <button type="button" onClick={onClear} className="text-muted-foreground hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="w-full flex items-center gap-2 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-accent/20 px-3 py-2.5 text-xs text-muted-foreground transition-colors cursor-pointer"
        >
          <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Select {label} *
        </label>
      )}
    </div>
  );
}

// ── Voice recorder ───────────────────────────────────────────────────────────

const WAVE_STYLE = `
  @keyframes voice-wave {
    0%, 100% { transform: scaleY(0.25); }
    50%       { transform: scaleY(1);    }
  }
`;
const WAVE_DELAYS = ["0s", "0.12s", "0.24s", "0.36s", "0.24s", "0.12s", "0s"];

function WaveformBars() {
  return (
    <>
      <style>{WAVE_STYLE}</style>
      <div className="flex items-center gap-[3px] h-6">
        {WAVE_DELAYS.map((delay, i) => (
          <div
            key={i}
            className="w-[3px] bg-red-500 rounded-full origin-center"
            style={{ height: "100%", animation: `voice-wave 0.8s ease-in-out ${delay} infinite` }}
          />
        ))}
      </div>
    </>
  );
}

async function convertWebmToMp3(webmBlob) {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();
  const sampleRate = audioBuffer.sampleRate;
  const pcm = audioBuffer.getChannelData(0);
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
  const blockSize = 1152;
  const chunks = [];
  for (let i = 0; i < pcm.length; i += blockSize) {
    const slice = pcm.subarray(i, i + blockSize);
    const int16 = new Int16Array(slice.length);
    for (let j = 0; j < slice.length; j++) {
      int16[j] = Math.max(-32768, Math.min(32767, slice[j] * 32767));
    }
    const buf = encoder.encodeBuffer(int16);
    if (buf.length > 0) chunks.push(new Uint8Array(buf));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(new Uint8Array(tail));
  return new Blob(chunks, { type: "audio/mpeg" });
}

function getSupportedMimeType() {
  const types = ["audio/ogg;codecs=opus", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  return types.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || "";
}

function mimeToExt(mime) {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  return "ogg"; // Chrome webm/opus → relabel as ogg for WhatsApp compatibility
}

function mimeForUpload(recordedMime) {
  if (recordedMime.includes("ogg") || recordedMime.includes("mp4")) return recordedMime;
  return "audio/ogg"; // webm/Opus → relabeled as ogg/Opus
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function VoiceRecorder({ onSend, onCancel }) {
  const [phase, setPhase] = useState("recording");
  const [seconds, setSeconds] = useState(0);
  const [blobUrl, setBlobUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [micError, setMicError] = useState(null);

  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const blobRef = useRef(null);
  const mimeRef = useRef("");

  useEffect(() => {
    const mime = getSupportedMimeType();
    mimeRef.current = mime;

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
        const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        mrRef.current = mr;

        mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
          blobRef.current = blob;
          setBlobUrl(URL.createObjectURL(blob));
          setPhase("preview");
          stream.getTracks().forEach((t) => t.stop());
        };

        mr.start(100);
        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      })
      .catch(() => setMicError("Microphone access denied."));

    return () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopRecording = useCallback(() => {
    clearInterval(timerRef.current);
    if (mrRef.current?.state === "recording") mrRef.current.stop();
  }, []);

  const handleDiscard = useCallback(() => {
    clearInterval(timerRef.current);
    if (mrRef.current?.state === "recording") mrRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    onCancel();
  }, [blobUrl, onCancel]);

  const handleSend = useCallback(async () => {
    if (!blobRef.current) return;
    setUploading(true);
    try {
      let uploadBlob = blobRef.current;
      let ext = mimeToExt(mimeRef.current);
      let uploadMime = mimeForUpload(mimeRef.current);

      // Only OGG/Opus (Firefox) is confirmed to work with SP→WhatsApp.
      // Convert Chrome webm AND Safari m4a to MP3 (audio/mpeg).
      if (!mimeRef.current.includes("ogg")) {
        try {
          uploadBlob = await convertWebmToMp3(blobRef.current);
          ext = "mp3";
          uploadMime = "audio/mpeg";
        } catch (convErr) {
          console.error("audio→mp3 conversion failed:", convErr);
        }
      }

      const file = new File([uploadBlob], `voice-note-${Date.now()}.${ext}`, { type: uploadMime });
      const { path } = await base44.storage.uploadAttachment(file, { contentType: uploadMime });
      const publicUrl = base44.storage.getPublicUrl(path);
      await onSend({ message_type: "audio", media_url: publicUrl || "", media_name: file.name, message_text: "" });
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    } finally {
      setUploading(false);
    }
  }, [blobUrl, onSend]);

  if (micError) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive py-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{micError}</span>
        <button type="button" onClick={onCancel} className="ml-auto text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-3">
        {/* Discard */}
        <button
          type="button"
          onClick={handleDiscard}
          className="h-10 w-10 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
          title="Discard"
        >
          <Trash2 className="h-4 w-4" />
        </button>

        {phase === "recording" ? (
          <>
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <WaveformBars />
            <span className="text-sm font-mono text-red-500 tabular-nums flex-shrink-0 min-w-[36px]">
              {formatDuration(seconds)}
            </span>
            <button
              type="button"
              onClick={stopRecording}
              className="ml-auto h-10 w-10 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0"
              title="Stop recording"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          </>
        ) : (
          <>
            <audio controls src={blobUrl} className="flex-1 h-9 min-w-0" />
            <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
              {formatDuration(seconds)}
            </span>
          </>
        )}
      </div>

      {phase === "preview" && (
        <Button
          className="w-full gap-2"
          onClick={handleSend}
          disabled={uploading}
        >
          {uploading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
          ) : (
            <><Send className="h-4 w-4" /> Send Voice Note</>
          )}
        </Button>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "template", label: "Template", Icon: FileText },
  { id: "voice",    label: "Voice",    Icon: Mic },
];

export default function ImTemplatePanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [conv, setConv] = useState(null);
  const [tab, setTab] = useState("template");

  // Templates
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Template state
  const [templateName, setTemplateName] = useState("");
  const [templateLang, setTemplateLang] = useState("en");
  const [templateBodyText, setTemplateBodyText] = useState("");
  const [templateParams, setTemplateParams] = useState([]);
  const [templateHeaderType, setTemplateHeaderType] = useState("NONE");
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);

  // Send state
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentLabel, setSentLabel] = useState("");
  const [sendError, setSendError] = useState(null);

  // ── Load BX24 + resolve conversation ──────────────────────────────────────
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        await base44.auth.me();
      } catch {
        if (!dead) { setError("Sign in required."); setLoading(false); }
        return;
      }

      await loadBx24();

      if (!window.BX24) {
        if (!dead) setLoading(false);
        return;
      }

      window.BX24.init(async () => {
        if (dead) return;
        try {
          const info = window.BX24.placement.info();
          const dialogId = info?.options?.dialogId || info?.options?.DIALOG_ID || info?.options?.dialog_id || "";
          console.log("[ImTemplate] dialogId:", dialogId, "placement:", info?.placement);

          let chatId = null;
          if (dialogId) {
            const numMatch = dialogId.match(/(\d+)$/);
            if (numMatch) chatId = Number(numMatch[1]);
          }

          if (chatId) {
            const { data: rows } = await supabase
              .from("conversations")
              .select("*")
              .eq("bitrix24_chat_id", chatId)
              .limit(1)
              .maybeSingle();
            if (rows && !dead) setConv(rows);
            else console.warn("[ImTemplate] no conversation for chatId:", chatId);
          }

          if (!dead) {
            try { window.BX24.resizeWindow(420, 560); } catch {}
            setLoading(false);
          }
        } catch (e) {
          console.warn("[ImTemplate] init error:", e.message);
          if (!dead) setLoading(false);
        }
      });
    })();
    return () => { dead = true; };
  }, []);

  // ── Fetch templates ────────────────────────────────────────────────────────
  const fetchTemplates = useCallback(async (botId) => {
    if (!botId) return;
    setTemplatesLoading(true);
    try {
      const res = await base44.functions.invoke("getSendPulseTemplates", { botId });
      const list = res.data?.templates || [];
      setTemplates(list);
      if (list.length > 0 && !templateName) applyTemplate(list[0]);
    } catch (e) {
      console.warn("[ImTemplate] failed to load templates:", e.message);
    } finally {
      setTemplatesLoading(false);
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    if (conv?.sendpulse_bot_id) fetchTemplates(conv.sendpulse_bot_id);
  }, [conv?.sendpulse_bot_id]); // eslint-disable-line

  // ── Template helpers ───────────────────────────────────────────────────────

  const applyTemplate = (t) => {
    setTemplateName(t.name);
    setTemplateLang(t.language || "en");
    setTemplateBodyText(t.bodyText || "");
    setTemplateParams(t.paramCount > 0 ? Array(t.paramCount).fill("") : []);
    setTemplateHeaderType(t.headerType || "NONE");
    clearMedia();
  };

  const setParam = (idx, val) => {
    setTemplateParams((prev) => {
      const next = [...prev];
      while (next.length <= idx) next.push("");
      next[idx] = val;
      return next;
    });
  };

  const clearMedia = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview(null);
  };

  const handleMediaChange = (file) => {
    if (!file) return;
    setMediaFile(file);
    if (templateHeaderType === "IMAGE" && file.type.startsWith("image/")) {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
      setMediaPreview(URL.createObjectURL(file));
    }
  };

  const parsedBody = templateBodyText ? parseBody(templateBodyText) : [];
  const hasInlineVars = parsedBody.some((p) => p.kind === "var");
  const needsMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(templateHeaderType);

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = async (payload) => {
    setSending(true);
    setSendError(null);
    try {
      await base44.functions.invoke("sendMessage", {
        conversation_id: conv?.id || null,
        ...payload,
      });
      setSentLabel(payload.message_type === "audio" ? "Voice note sent!" : "Template sent!");
      setSent(true);
      setTimeout(() => {
        try { window.BX24?.closeApplication(); } catch {}
      }, 1500);
    } catch (e) {
      setSendError(e.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleSendTemplate = async () => {
    if (!templateName) return;
    let mediaUrl = "";
    if (needsMedia && mediaFile) {
      setSending(true);
      try {
        const { path } = await base44.storage.uploadAttachment(mediaFile);
        mediaUrl = base44.storage.getPublicUrl(path);
      } catch (e) {
        setSendError(e.message || "Upload failed");
        setSending(false);
        return;
      }
    }
    await handleSend({
      message_type: "template",
      template_name: templateName,
      template_language: templateLang || "en",
      template_params: templateParams.filter((p) => p.trim()),
      template_header_type: templateHeaderType,
      template_media_url: mediaUrl,
      message_text: "",
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-6 text-center bg-background">
        <AlertCircle className="h-8 w-8 text-destructive mb-2 opacity-60" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-6 text-center bg-background">
        <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
        <p className="text-sm font-medium">{sentLabel}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {conv?.contact_name || conv?.contact_phone || "Contact"} will receive it shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-background font-inter">

      {/* Contact header */}
      <div className="px-4 pt-4 pb-3 border-b border-border/50">
        <p className="text-xs font-semibold text-foreground">
          {conv ? (conv.contact_name || conv.contact_phone || "Contact") : (
            <span className="text-amber-500">No linked conversation found.</span>
          )}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/50">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors flex-1 justify-center
              ${tab === id
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
              }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* ── Template tab ── */}
        {tab === "template" && (
          <>
            {/* Template selector — native <select> works reliably inside iframes */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Template</label>
                <button
                  type="button"
                  onClick={() => fetchTemplates(conv?.sendpulse_bot_id)}
                  disabled={templatesLoading || !conv?.sendpulse_bot_id}
                  className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${templatesLoading ? "animate-spin" : ""}`} /> Sync
                </button>
              </div>
              {templatesLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading templates…
                </div>
              ) : (
                <select
                  value={templateName}
                  onChange={(e) => {
                    const t = templates.find((x) => x.name === e.target.value);
                    if (t) applyTemplate(t);
                  }}
                  disabled={templates.length === 0}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
                >
                  {templates.length === 0 && <option value="">No templates found</option>}
                  {templates.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} [{t.headerType}] {t.language?.toUpperCase()}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Media upload */}
            {needsMedia && (
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  Header {templateHeaderType.charAt(0) + templateHeaderType.slice(1).toLowerCase()}
                  <span className="text-destructive ml-1">*</span>
                </label>
                <MediaPicker
                  inputId="im-template-media"
                  headerType={templateHeaderType}
                  file={mediaFile}
                  previewUrl={mediaPreview}
                  onChange={handleMediaChange}
                  onClear={clearMedia}
                />
              </div>
            )}

            {/* Inline editable preview */}
            {templateName && templateBodyText && (
              <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
                <div className="px-3 pt-2 pb-1 border-b border-border/40">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Preview</span>
                </div>
                <div className="p-3 text-sm leading-relaxed" dir="auto">
                  {parsedBody.map((part, i) =>
                    part.kind === "text" ? (
                      <span key={i} className="whitespace-pre-wrap">{part.value}</span>
                    ) : (
                      <input
                        key={i}
                        value={templateParams[part.idx] ?? ""}
                        onChange={(e) => setParam(part.idx, e.target.value)}
                        placeholder={`{{${part.idx + 1}}}`}
                        className="inline bg-primary/10 border-b-2 border-primary/40 hover:border-primary/60 focus:border-primary text-primary placeholder:text-primary/40 focus:outline-none px-1 mx-0.5 text-sm transition-colors rounded-sm"
                        style={{ width: `${Math.max((templateParams[part.idx]?.length ?? 0) + 4, 8)}ch` }}
                      />
                    )
                  )}
                </div>
              </div>
            )}

            {/* Fallback param inputs */}
            {templateName && !hasInlineVars && templateParams.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium">Body Parameters</label>
                <div className="space-y-1.5">
                  {templateParams.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-8 text-right flex-shrink-0">{`{{${i + 1}}}`}</span>
                      <Input
                        value={p}
                        onChange={(e) => setParam(i, e.target.value)}
                        placeholder={`Parameter ${i + 1}`}
                        className="text-sm flex-1 h-8"
                      />
                      <button
                        type="button"
                        onClick={() => setTemplateParams((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive flex-shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sendError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {sendError}
              </p>
            )}

            <Button
              className="w-full gap-2"
              disabled={!templateName || !conv || sending || (needsMedia && !mediaFile)}
              onClick={handleSendTemplate}
            >
              {sending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
              ) : (
                <><Send className="h-4 w-4" /> Send Template</>
              )}
            </Button>

            {!conv && templateName && (
              <p className="text-[11px] text-center text-muted-foreground">
                This chat isn't linked to a noqtaChat conversation yet.<br />
                Open the chat from the noqtaChat dashboard first.
              </p>
            )}
          </>
        )}

        {/* ── Voice tab ── */}
        {tab === "voice" && (
          <>
            {!conv && (
              <p className="text-xs text-amber-500 text-center py-2">
                No linked conversation — voice note may not be delivered.
              </p>
            )}
            {sendError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {sendError}
              </p>
            )}
            <VoiceRecorder
              onSend={handleSend}
              onCancel={() => setTab("template")}
            />
          </>
        )}

      </div>
    </div>
  );
}
