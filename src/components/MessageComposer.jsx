// @ts-nocheck
import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Image, Paperclip, Mic, FileText, X, Upload, Plus, Trash2, Square, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from "@/api/base44Client";
import TemplateSelect from "./TemplateSelect";

// ── Voice note waveform animation ─────────────────────────────────────────
const WAVE_STYLE = `
  @keyframes voice-wave {
    0%, 100% { transform: scaleY(0.25); }
    50%       { transform: scaleY(1);    }
  }
`;

const WAVE_DELAYS = ['0s', '0.12s', '0.24s', '0.36s', '0.24s', '0.12s', '0s'];

function WaveformBars() {
  return (
    <>
      <style>{WAVE_STYLE}</style>
      <div className="flex items-center gap-[3px] h-6">
        {WAVE_DELAYS.map((delay, i) => (
          <div
            key={i}
            className="w-[3px] bg-red-500 rounded-full origin-center"
            style={{
              height: '100%',
              animation: `voice-wave 0.8s ease-in-out ${delay} infinite`,
            }}
          />
        ))}
      </div>
    </>
  );
}

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return types.find((t) => {
    try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
  }) || '';
}

function mimeToExt(mime) {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  return 'webm';
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// phase: 'recording' | 'preview'
function VoiceRecorder({ onSend, onCancel }) {
  const [phase, setPhase] = useState('recording');
  const [seconds, setSeconds] = useState(0);
  const [blobUrl, setBlobUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [micError, setMicError] = useState(null);

  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const blobRef = useRef(null);
  const mimeRef = useRef('');

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
          const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
          blobRef.current = blob;
          setBlobUrl(URL.createObjectURL(blob));
          setPhase('preview');
          stream.getTracks().forEach((t) => t.stop());
        };

        mr.start(100);
        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      })
      .catch(() => {
        setMicError('Microphone access denied.');
      });

    return () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopRecording = useCallback(() => {
    clearInterval(timerRef.current);
    if (mrRef.current?.state === 'recording') mrRef.current.stop();
  }, []);

  const handleDiscard = useCallback(() => {
    clearInterval(timerRef.current);
    if (mrRef.current?.state === 'recording') mrRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    onCancel();
  }, [blobUrl, onCancel]);

  const handleSend = useCallback(async () => {
    if (!blobRef.current) return;
    setUploading(true);
    try {
      const ext = mimeToExt(mimeRef.current);
      const file = new File([blobRef.current], `voice-note-${Date.now()}.${ext}`, {
        type: blobRef.current.type,
      });
      const { path } = await base44.storage.uploadAttachment(file);
      const publicUrl = base44.storage.getPublicUrl(path);
      await onSend({ message_type: 'audio', media_url: publicUrl || '', media_name: file.name, message_text: '' });
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    } finally {
      setUploading(false);
    }
  }, [blobUrl, onSend]);

  if (micError) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive py-1">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{micError}</span>
        <button onClick={onCancel} className="ml-auto text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-1">
      {/* Discard */}
      <button
        onClick={handleDiscard}
        className="h-9 w-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
        title="Discard"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      {phase === 'recording' ? (
        <>
          {/* Red dot */}
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <WaveformBars />
          <span className="text-sm font-mono text-red-500 tabular-nums flex-shrink-0 min-w-[36px]">
            {formatDuration(seconds)}
          </span>
          {/* Stop */}
          <button
            onClick={stopRecording}
            className="ml-auto h-10 w-10 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0"
            title="Stop recording"
          >
            <Square className="h-4 w-4 fill-current" />
          </button>
        </>
      ) : (
        <>
          {/* Preview player */}
          <audio controls src={blobUrl} className="flex-1 h-9 min-w-0" />
          <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
            {formatDuration(seconds)}
          </span>
          {/* Send */}
          <button
            onClick={handleSend}
            disabled={uploading}
            className="h-10 w-10 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex-shrink-0"
            title="Send voice note"
          >
            {uploading
              ? <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Send className="h-4 w-4" />
            }
          </button>
        </>
      )}
    </div>
  );
}

const MODES = [
  { id: "text", label: "Text", icon: FileText },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "image", label: "Image", icon: Image },
  { id: "file", label: "File", icon: Paperclip },
  { id: "template", label: "Template", icon: Plus },
];

function MediaDropzone({ mode, mediaFile, onFileChange, onClear, previewUrl }) {
  const fileInputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const acceptMap = { image: "image/*", audio: "audio/*", file: "*/*" };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileChange(file);
  };

  return (
    <div
      className={`border-2 border-dashed rounded-xl transition-colors cursor-pointer
        ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/20"}
      `}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptMap[mode]}
        className="hidden"
        onChange={(e) => onFileChange(e.target.files?.[0] || null)}
      />

      {mediaFile ? (
        <div className="p-3">
          {mode === "image" && previewUrl ? (
            <div className="relative">
              <img
                src={previewUrl}
                alt="preview"
                className="w-full max-h-48 object-contain rounded-lg bg-muted"
              />
              <button
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                className="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{mediaFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(mediaFile.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                className="text-muted-foreground hover:text-destructive flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-6 px-4">
          <Upload className="h-6 w-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground text-center">
            Click or drag & drop to select {mode}
          </p>
        </div>
      )}
    </div>
  );
}

function parseTemplateBody(text) {
  const parts = [];
  const regex = /\{\{\s*(\d+)\s*\}\}/g;
  let last = 0, m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
    parts.push({ kind: "var", idx: parseInt(m[1]) - 1 });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

function TemplateComposer({
  conversation, templateName, templateBodyText, templateParams, templateHeaderType,
  templateMediaFile, templateMediaPreview, uploading, canSend,
  onSelect, onParamsChange, onMediaChange, onMediaClear, onSend,
}) {
  const parsedBody = templateBodyText ? parseTemplateBody(templateBodyText) : [];
  const hasInlineVars = parsedBody.some((p) => p.kind === "var");

  const setParam = (idx, val) => {
    const next = [...templateParams];
    // grow array if needed (user can add params beyond auto-detected count)
    while (next.length <= idx) next.push("");
    next[idx] = val;
    onParamsChange(next);
  };

  return (
    <div className="space-y-3">
      <TemplateSelect
        botId={conversation?.sendpulse_bot_id}
        selectedName={templateName}
        onSelect={onSelect}
      />

      {/* Header media upload */}
      {["IMAGE", "VIDEO", "DOCUMENT"].includes(templateHeaderType) && (
        <div className="space-y-1">
          <Label className="text-xs">
            Header {templateHeaderType.charAt(0) + templateHeaderType.slice(1).toLowerCase()}
            <span className="text-destructive ml-1">*</span>
          </Label>
          <MediaDropzone
            mode={templateHeaderType === "IMAGE" ? "image" : "file"}
            mediaFile={templateMediaFile}
            onFileChange={onMediaChange}
            onClear={onMediaClear}
            previewUrl={templateMediaPreview}
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

      {/* Fallback: separate param inputs when body text unavailable or has no vars */}
      {templateName && !hasInlineVars && (
        <div className="space-y-1">
          <Label className="text-xs">Body Parameters</Label>
          <div className="space-y-1.5">
            {templateParams.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-8 text-right flex-shrink-0">{`{{${i + 1}}}`}</span>
                <Input
                  value={p}
                  onChange={(e) => setParam(i, e.target.value)}
                  placeholder={`Parameter ${i + 1}`}
                  className="text-sm flex-1"
                />
                <button
                  onClick={() => onParamsChange(templateParams.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive flex-shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => onParamsChange([...templateParams, ""])}
              className="text-xs text-primary hover:underline"
            >
              + Add parameter
            </button>
          </div>
        </div>
      )}

      <Button onClick={onSend} disabled={!canSend()} className="w-full gap-2">
        {uploading ? (
          <>
            <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Uploading…
          </>
        ) : (
          <><Send className="h-4 w-4" /> Send Template</>
        )}
      </Button>
    </div>
  );
}

export default function MessageComposer({ conversation, onSend, isSending, error }) {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateLang, setTemplateLang] = useState("en");
  const [templateParams, setTemplateParams] = useState([]);
  const [templateBodyText, setTemplateBodyText] = useState("");
  const [templateHeaderType, setTemplateHeaderType] = useState("NONE");
  const [templateMediaFile, setTemplateMediaFile] = useState(null);
  const [templateMediaPreview, setTemplateMediaPreview] = useState(null);

  const channel = conversation?.channel || "whatsapp";
  const isWhatsApp = channel === "whatsapp";

  const resetForm = () => {
    setText("");
    setCaption("");
    setMediaFile(null);
    setPreviewUrl(null);
    setTemplateName("");
    setTemplateLang("en");
    setTemplateParams([]);
    setTemplateBodyText("");
    setTemplateHeaderType("NONE");
    if (templateMediaPreview) URL.revokeObjectURL(templateMediaPreview);
    setTemplateMediaFile(null);
    setTemplateMediaPreview(null);
  };

  const handleFileChange = (file) => {
    if (!file) return;
    setMediaFile(file);
    if (mode === "image" && file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  const handleClear = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setMediaFile(null);
    setPreviewUrl(null);
  };

  const uploadAndSend = async () => {
    if (!mediaFile) return;
    setUploading(true);
    try {
      const { path } = await base44.storage.uploadAttachment(mediaFile);
      const publicUrl = base44.storage.getPublicUrl(path);
      await onSend({
        message_type: mode,
        media_url: publicUrl || "",
        media_name: mediaFile.name,
        message_text: caption,
      });
      resetForm();
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (mode === "text") {
      const msg = text.trim();
      if (!msg) return;
      setText(""); // clear immediately so next message can be typed while this one sends
      try {
        await onSend({ message_type: "text", message_text: msg });
      } catch (_) {} // error displayed via `error` prop from parent
    } else if (mode === "image" || mode === "file") {
      await uploadAndSend();
    } else if (mode === "template") {
      if (!templateName.trim()) return;
      let mediaUrl = "";
      const needsMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(templateHeaderType);
      if (needsMedia && templateMediaFile) {
        setUploading(true);
        try {
          const { path } = await base44.storage.uploadAttachment(templateMediaFile);
          mediaUrl = base44.storage.getPublicUrl(path);
        } finally {
          setUploading(false);
        }
      }
      await onSend({
        message_type: "template",
        template_name: templateName.trim(),
        template_language: templateLang.trim() || "en",
        template_params: templateParams.filter((p) => p.trim()),
        template_header_type: templateHeaderType,
        template_media_url: mediaUrl,
        message_text: "",
      });
      resetForm();
    }
  };

  const canSend = () => {
    if (uploading) return false;
    // isSending only blocks non-text modes; for text, text is cleared immediately
    // so the user can send the next message while the previous is in-flight
    if (mode !== "text" && isSending) return false;
    if (mode === "text") return text.trim().length > 0;
    if (mode === "voice") return false; // VoiceRecorder handles its own send
    if (mode === "template") {
      if (!templateName.trim()) return false;
      const needsMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(templateHeaderType);
      if (needsMedia && !templateMediaFile) return false;
      return true;
    }
    return !!mediaFile;
  };

  return (
    <div className="border-t border-border bg-card">
      {/* Mode tabs */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b border-border/50">
        {MODES.filter((m) => m.id !== "template" || isWhatsApp).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { setMode(id); resetForm(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-medium transition-colors
              ${mode === id
                ? "bg-background text-foreground border border-b-0 border-border"
                : "text-muted-foreground hover:text-foreground"
              }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Compose area */}
      <div className="px-4 py-3 space-y-2">
        {mode === "text" && (
          <div className="flex items-end gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend()) handleSend();
                }
              }}
              placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
              className="flex-1 min-h-[44px] max-h-32 resize-none text-sm"
              rows={1}
            />
            <Button size="icon" onClick={handleSend} disabled={!canSend()} className="h-11 w-11 flex-shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}

        {mode === "voice" && (
          <VoiceRecorder
            key={mode}
            onSend={async (payload) => { await onSend(payload); setMode("text"); }}
            onCancel={() => setMode("text")}
          />
        )}

        {(mode === "image" || mode === "file") && (
          <div className="space-y-2">
            <MediaDropzone
              mode={mode}
              mediaFile={mediaFile}
              onFileChange={handleFileChange}
              onClear={handleClear}
              previewUrl={previewUrl}
            />
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={mode === "image" ? "Caption (optional)" : "Description (optional)"}
              className="text-sm"
            />
            <Button onClick={handleSend} disabled={!canSend()} className="w-full gap-2">
              {uploading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </>
              )}
            </Button>
          </div>
        )}

        {mode === "template" && (
          <TemplateComposer
            conversation={conversation}
            templateName={templateName}
            templateBodyText={templateBodyText}
            templateParams={templateParams}
            templateHeaderType={templateHeaderType}
            templateMediaFile={templateMediaFile}
            templateMediaPreview={templateMediaPreview}
            uploading={uploading}
            canSend={canSend}
            onSelect={(t) => {
              setTemplateName(t.name);
              setTemplateLang(t.language || "en");
              setTemplateBodyText(t.bodyText || "");
              // Size params array to match detected count (from bodyText or paramCount)
              const count = t.paramCount || 0;
              setTemplateParams(count > 0 ? Array(count).fill("") : []);
              setTemplateHeaderType(t.headerType || "NONE");
              if (templateMediaPreview) URL.revokeObjectURL(templateMediaPreview);
              setTemplateMediaFile(null);
              setTemplateMediaPreview(null);
            }}
            onParamsChange={setTemplateParams}
            onMediaChange={(file) => {
              setTemplateMediaFile(file);
              if (file && templateHeaderType === "IMAGE" && file.type.startsWith("image/")) {
                if (templateMediaPreview) URL.revokeObjectURL(templateMediaPreview);
                setTemplateMediaPreview(URL.createObjectURL(file));
              } else {
                setTemplateMediaPreview(null);
              }
            }}
            onMediaClear={() => {
              if (templateMediaPreview) URL.revokeObjectURL(templateMediaPreview);
              setTemplateMediaFile(null);
              setTemplateMediaPreview(null);
            }}
            onSend={handleSend}
          />
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
