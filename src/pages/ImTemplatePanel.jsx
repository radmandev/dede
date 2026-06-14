import { useState, useEffect, useRef } from "react";
import { base44, supabase } from "@/api/base44Client";
import { Send, CheckCircle2, AlertCircle, Loader2, RefreshCw, X } from "lucide-react";
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

// ── File picker — uses <label> so it works inside sandboxed iframes ──────────

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

// ── Main page ────────────────────────────────────────────────────────────────

export default function ImTemplatePanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [conv, setConv] = useState(null);

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

  // ── Fetch templates when conv is resolved ─────────────────────────────────
  const fetchTemplates = async (botId) => {
    if (!botId) return;
    setTemplatesLoading(true);
    try {
      const res = await base44.functions.invoke("getSendPulseTemplates", { botId });
      const list = res.data?.templates || [];
      setTemplates(list);
      // Auto-select first if none selected
      if (list.length > 0 && !templateName) {
        applyTemplate(list[0]);
      }
    } catch (e) {
      console.warn("[ImTemplate] failed to load templates:", e.message);
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    if (conv?.sendpulse_bot_id) fetchTemplates(conv.sendpulse_bot_id);
  }, [conv?.sendpulse_bot_id]); // eslint-disable-line

  // ── Helpers ────────────────────────────────────────────────────────────────

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
        <p className="text-sm font-medium">Template sent!</p>
        <p className="text-xs text-muted-foreground mt-1">
          {conv?.contact_name || conv?.contact_phone || "Contact"} will receive it shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-background font-inter p-4">
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
              {templates.length === 0 && (
                <option value="">No templates found</option>
              )}
              {templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} [{t.headerType}] {t.language?.toUpperCase()}
                </option>
              ))}
            </select>
          )}
          {!conv?.sendpulse_bot_id && !templatesLoading && (
            <p className="text-xs text-muted-foreground">No bot linked to this conversation.</p>
          )}
        </div>

        {/* Media upload — <label> wrapping works in sandboxed iframes */}
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

        {/* Fallback param inputs when body has no inline {{N}} vars */}
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
