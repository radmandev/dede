import { useState, useEffect, useRef } from "react";
import { base44, supabase } from "@/api/base44Client";
import { Send, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import TemplateSelect from "../components/TemplateSelect";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { X, Upload } from "lucide-react";
import { useRef as useFileRef } from "react";

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

// ── Compact media dropzone ───────────────────────────────────────────────────

function MediaPicker({ headerType, file, previewUrl, onChange, onClear }) {
  const ref = useRef(null);
  const isImage = headerType === "IMAGE";
  return (
    <div>
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept={isImage ? "image/*" : "*/*"}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          {isImage && previewUrl ? (
            <img src={previewUrl} className="h-10 w-10 object-cover rounded" alt="preview" />
          ) : null}
          <span className="text-xs truncate flex-1">{file.name}</span>
          <button onClick={onClear} className="text-muted-foreground hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="w-full flex items-center gap-2 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-accent/20 px-3 py-2.5 text-xs text-muted-foreground transition-colors"
        >
          <Upload className="h-3.5 w-3.5 flex-shrink-0" />
          Select {headerType.charAt(0) + headerType.slice(1).toLowerCase()} *
        </button>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ImTemplatePanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [conv, setConv] = useState(null);

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
        // Dev fallback: try to use a hardcoded conv for testing
        if (!dead) setLoading(false);
        return;
      }

      window.BX24.init(async () => {
        if (dead) return;
        try {
          const info = window.BX24.placement.info();
          // IM_TEXTAREA sends dialogId (camelCase); legacy fallbacks for other placements
          const dialogId = info?.options?.dialogId || info?.options?.DIALOG_ID || info?.options?.dialog_id || "";
          console.log("[ImTemplate] DIALOG_ID:", dialogId, "placement:", info?.placement);

          // Parse numeric chat ID from formats: "chat17", "17", "imol/5/17"
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
            if (rows) {
              if (!dead) setConv(rows);
            } else {
              console.warn("[ImTemplate] no conversation for chatId:", chatId);
            }
          }

          if (!dead) {
            // Tell Bitrix24 to adjust the iframe to content size
            try { window.BX24.fitWindow(); } catch {}
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

  // ── Helpers ────────────────────────────────────────────────────────────────

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

  const needsMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(templateHeaderType);

  const canSend =
    !sending &&
    !!templateName &&
    (!needsMedia || !!mediaFile) &&
    (!parsedBody.some((p) => p.kind === "var") ||
      templateParams.every((p) => p.trim()));

  const parsedBody = templateBodyText ? parseBody(templateBodyText) : [];
  const hasInlineVars = parsedBody.some((p) => p.kind === "var");

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!templateName) return;
    setSending(true);
    setSendError(null);
    try {
      let mediaUrl = "";
      if (needsMedia && mediaFile) {
        const { path } = await base44.storage.uploadAttachment(mediaFile);
        mediaUrl = base44.storage.getPublicUrl(path);
      }

      await base44.functions.invoke("sendMessage", {
        conversation_id: conv?.id || null,
        message_type: "template",
        template_name: templateName,
        template_language: templateLang || "en",
        template_params: templateParams.filter((p) => p.trim()),
        template_header_type: templateHeaderType,
        template_media_url: mediaUrl,
        message_text: "",
      });

      setSent(true);
      // Auto-close the panel in Bitrix24 after a short delay
      setTimeout(() => {
        try { window.BX24?.closeApplication(); } catch {}
      }, 1500);
    } catch (e) {
      setSendError(e.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-background">
        <AlertCircle className="h-8 w-8 text-destructive mb-2 opacity-60" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-background">
        <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
        <p className="text-sm font-medium">Template sent!</p>
        <p className="text-xs text-muted-foreground mt-1">
          {conv?.contact_name || conv?.contact_phone || "Contact"} will receive it shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-inter p-4">
      <div className="max-w-sm mx-auto space-y-4">

        {/* Header */}
        <div>
          <h2 className="text-sm font-semibold">Send Template</h2>
          {conv ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              To: {conv.contact_name || conv.contact_phone || "Contact"}
            </p>
          ) : (
            <p className="text-xs text-amber-500 mt-0.5">
              No linked conversation found for this chat.
            </p>
          )}
        </div>

        {/* Template selector */}
        <TemplateSelect
          botId={conv?.sendpulse_bot_id}
          selectedName={templateName}
          onSelect={(t) => {
            setTemplateName(t.name);
            setTemplateLang(t.language || "en");
            setTemplateBodyText(t.bodyText || "");
            setTemplateParams(t.paramCount > 0 ? Array(t.paramCount).fill("") : []);
            setTemplateHeaderType(t.headerType || "NONE");
            clearMedia();
          }}
        />

        {/* Media upload for header */}
        {needsMedia && (
          <div className="space-y-1">
            <Label className="text-xs">
              Header {templateHeaderType.charAt(0) + templateHeaderType.slice(1).toLowerCase()}
              <span className="text-destructive ml-1">*</span>
            </Label>
            <MediaPicker
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
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Preview
              </span>
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

        {/* Fallback: separate param inputs when bodyText has no inline vars */}
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
                    className="text-sm flex-1 h-8"
                  />
                  <button
                    onClick={() => setTemplateParams((prev) => prev.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive flex-shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setTemplateParams((prev) => [...prev, ""])}
                className="text-xs text-primary hover:underline"
              >
                + Add parameter
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {sendError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {sendError}
          </p>
        )}

        {/* Send button */}
        <Button
          className="w-full gap-2"
          disabled={!templateName || !conv || sending || (needsMedia && !mediaFile)}
          onClick={handleSend}
        >
          {sending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
          ) : (
            <><Send className="h-4 w-4" /> Send Template</>
          )}
        </Button>

        {!conv && templateName && (
          <p className="text-[11px] text-center text-muted-foreground">
            The conversation for this chat is not found in noqtaChat.<br />
            Open the chat from noqtaChat dashboard first to link it.
          </p>
        )}
      </div>
    </div>
  );
}
