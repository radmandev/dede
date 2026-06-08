import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44, supabase } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Phone, User, ChevronRight, ChevronLeft, Upload, X } from "lucide-react";
import { toast } from "sonner";
import TemplateSelect from "./TemplateSelect";

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

function MediaInput({ headerType, file, onFileChange, onClear, previewUrl }) {
  const fileInputRef = useRef(null);
  const accept = headerType === "IMAGE" ? "image/*" : headerType === "VIDEO" ? "video/*" : "*/*";

  return (
    <div className="space-y-1">
      <Label className="text-xs">
        Header {headerType.charAt(0) + headerType.slice(1).toLowerCase()}
        <span className="text-destructive ml-1">*</span>
      </Label>
      <div
        className="border-2 border-dashed rounded-xl cursor-pointer hover:border-primary/50 hover:bg-accent/20 transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] || null)}
        />
        {file ? (
          <div className="p-3">
            {headerType === "IMAGE" && previewUrl ? (
              <div className="relative">
                <img src={previewUrl} alt="preview" className="w-full max-h-40 object-contain rounded-lg bg-muted" />
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
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onClear(); }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-5 px-4">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground text-center">
              Click to select {headerType.toLowerCase()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      {[1, 2].map((n) => (
        <div key={n} className="flex items-center gap-2">
          <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
            step === n
              ? "bg-primary text-primary-foreground"
              : step > n
              ? "bg-primary/20 text-primary"
              : "bg-muted text-muted-foreground"
          }`}>
            {n}
          </div>
          <span className={`text-xs ${step === n ? "text-foreground font-medium" : "text-muted-foreground"}`}>
            {n === 1 ? "Contact" : "Template"}
          </span>
          {n < 2 && <div className="w-8 h-px bg-border mx-1" />}
        </div>
      ))}
    </div>
  );
}

export default function SendTemplateDialog({ open, onClose, onConversationCreated, defaultPhone = "" }) {
  const [step, setStep] = useState(1);

  // Step 1 state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [botId, setBotId] = useState("");

  // Step 2 state
  const [templateName, setTemplateName] = useState("");
  const [templateLang, setTemplateLang] = useState("en");
  const [templateParams, setTemplateParams] = useState([]);
  const [templateBodyText, setTemplateBodyText] = useState("");
  const [templateHeaderType, setTemplateHeaderType] = useState("NONE");
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (open && defaultPhone) setPhone(defaultPhone);
  }, [open, defaultPhone]);

  const { data: bots = [] } = useQuery({
    queryKey: ["whatsappBots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sendpulse_bots")
        .select("*")
        .eq("channel", "whatsapp");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  // Auto-select single bot
  useEffect(() => {
    if (bots.length === 1 && !botId) setBotId(bots[0].id);
  }, [bots.length]); // eslint-disable-line

  const handleClose = () => {
    setStep(1);
    setName("");
    setPhone("");
    setBotId("");
    setTemplateName("");
    setTemplateLang("en");
    setTemplateParams([]);
    setTemplateBodyText("");
    setTemplateHeaderType("NONE");
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview(null);
    setSubmitError("");
    onClose();
  };

  const handleNext = (e) => {
    e.preventDefault();
    if (!phone.trim()) { toast.error("Phone number is required"); return; }
    if (!botId) { toast.error("Select a WhatsApp bot"); return; }
    setStep(2);
  };

  const handleSelectTemplate = (t) => {
    setTemplateName(t.name);
    setTemplateLang(t.language || "en");
    setTemplateBodyText(t.bodyText || "");
    const count = t.paramCount || 0;
    setTemplateParams(count > 0 ? Array(count).fill("") : []);
    setTemplateHeaderType(t.headerType || "NONE");
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview(null);
  };

  const handleMediaChange = (file) => {
    setMediaFile(file);
    if (file && templateHeaderType === "IMAGE" && file.type.startsWith("image/")) {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
      setMediaPreview(URL.createObjectURL(file));
    } else {
      setMediaPreview(null);
    }
  };

  const handleMediaClear = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview(null);
  };

  const handleSubmit = async () => {
    if (!templateName.trim()) { toast.error("Select a template"); return; }
    const needsMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(templateHeaderType);
    if (needsMedia && !mediaFile) { toast.error("Upload the required media for this template"); return; }

    setSubmitting(true);
    setSubmitError("");
    try {
      // Upload media first if required
      let mediaUrl = "";
      if (needsMedia && mediaFile) {
        const { path } = await base44.storage.uploadAttachment(mediaFile);
        mediaUrl = base44.storage.getPublicUrl(path);
      }

      // Single call: creates/finds SP contact + sends template + creates local conversation
      const res = await base44.functions.invoke("sendTemplateToNewContact", {
        botId,
        phone: phone.trim(),
        name: name.trim() || phone.trim(),
        templateName: templateName.trim(),
        templateLanguage: templateLang || "en",
        templateParams: templateParams.filter((p) => p.trim()),
        templateHeaderType,
        templateMediaUrl: mediaUrl,
      });

      if (res.data?.error) throw new Error(res.data.error);
      const conv = res.data?.conversation;
      if (!conv) throw new Error("Failed to create conversation");

      toast.success("Template sent successfully");
      if (onConversationCreated) onConversationCreated(conv);
      handleClose();
    } catch (err) {
      console.error("[SendTemplateDialog]", err);
      // FunctionsHttpError wraps the real body in err.context — extract it
      let msg = err?.message || "Failed to send";
      if (msg === "Edge Function returned a non-2xx status code") {
        try {
          const body = await err?.context?.json?.();
          msg = body?.error || body?.message || msg;
        } catch (_) {
          try { msg = (await err?.context?.text?.()) || msg; } catch (_) {}
        }
      }
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const parsedBody = templateBodyText ? parseTemplateBody(templateBodyText) : [];
  const hasInlineVars = parsedBody.some((p) => p.kind === "var");

  const setParam = (idx, val) => {
    const next = [...templateParams];
    while (next.length <= idx) next.push("");
    next[idx] = val;
    setTemplateParams(next);
  };

  const needsMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(templateHeaderType);
  const canSubmit = templateName.trim() && !submitting && (!needsMedia || mediaFile);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send Template to New Contact</DialogTitle>
        </DialogHeader>

        <StepIndicator step={step} />

        {step === 1 && (
          <form onSubmit={handleNext} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="st-name" className="text-sm">
                Name <span className="text-muted-foreground">(optional)</span>
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="st-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contact name"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="st-phone" className="text-sm">
                Phone number <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="st-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1234567890"
                  className="pl-9"
                  type="tel"
                  dir="ltr"
                />
              </div>
              <p className="text-xs text-muted-foreground">Include country code, e.g. +966XXXXXXXXX</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">
                WhatsApp bot <span className="text-destructive">*</span>
              </Label>
              <Select value={botId} onValueChange={setBotId} disabled={bots.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={bots.length === 0 ? "No bots available" : "Select a bot"} />
                </SelectTrigger>
                <SelectContent>
                  {bots.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name || b.bot_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1 gap-2" disabled={!phone.trim() || !botId}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4 pt-1">
            {/* Contact summary */}
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="font-medium truncate">{name || phone}</span>
              {name && <span className="text-muted-foreground text-xs truncate">({phone})</span>}
            </div>

            <TemplateSelect
              botId={botId}
              selectedName={templateName}
              onSelect={handleSelectTemplate}
            />

            {/* Media upload for templates that require it */}
            {needsMedia && (
              <MediaInput
                headerType={templateHeaderType}
                file={mediaFile}
                onFileChange={handleMediaChange}
                onClear={handleMediaClear}
                previewUrl={mediaPreview}
              />
            )}

            {/* Template body preview with inline editable params */}
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

            {/* Fallback param inputs when body has no detected vars but template has params */}
            {templateName && !hasInlineVars && templateParams.length > 0 && (
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
                    </div>
                  ))}
                </div>
              </div>
            )}

            {submitError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                {submitError}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => { setStep(1); setSubmitError(""); }}
                disabled={submitting}
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Button className="flex-1 gap-2" onClick={handleSubmit} disabled={!canSubmit}>
                {submitting ? (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {submitting ? "Sending…" : "Create & Send"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
