import { useState, useRef } from "react";
import { Send, Image, Paperclip, Mic, FileText, X, Upload, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from "@/api/base44Client";
import TemplateSelect from "./TemplateSelect";

const MODES = [
  { id: "text", label: "Text", icon: FileText },
  { id: "image", label: "Image", icon: Image },
  { id: "file", label: "File", icon: Paperclip },
  { id: "audio", label: "Audio", icon: Mic },
  { id: "template", label: "Template", icon: Plus },
];

export default function MessageComposer({ conversation, onSend, isSending, error }) {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateLang, setTemplateLang] = useState("en");
  const [templateParams, setTemplateParams] = useState([""]);
  const fileInputRef = useRef(null);

  const channel = conversation?.channel || "whatsapp";
  const isWhatsApp = channel === "whatsapp";

  const resetForm = () => {
    setText("");
    setCaption("");
    setMediaFile(null);
    setTemplateName("");
    setTemplateLang("en");
    setTemplateParams([""]);
  };

  const uploadAndSend = async () => {
    if (!mediaFile) return;
    setUploading(true);
    try {
      const { path } = await base44.storage.uploadAttachment(mediaFile);
      const publicUrl = base44.storage.getPublicUrl(path);
      await onSend({
        message_type: mode,
        media_url: publicUrl || '',
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
      if (!text.trim()) return;
      await onSend({ message_type: "text", message_text: text.trim() });
      setText("");
    } else if (mode === "image" || mode === "file" || mode === "audio") {
      await uploadAndSend();
    } else if (mode === "template") {
      if (!templateName.trim()) return;
      await onSend({
        message_type: "template",
        template_name: templateName.trim(),
        template_language: templateLang.trim() || "en",
        template_params: templateParams.filter(p => p.trim()),
        message_text: "",
      });
      resetForm();
    }
  };

  const canSend = () => {
    if (isSending || uploading) return false;
    if (mode === "text") return text.trim().length > 0;
    if (mode === "template") return templateName.trim().length > 0;
    return !!mediaFile;
  };

  const acceptMap = { image: "image/*", audio: "audio/*", file: "*/*" };

  return (
    <div className="border-t border-border bg-card">
      {/* Mode tabs */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b border-border/50">
        {MODES.filter(m => m.id !== "template" || isWhatsApp).map(({ id, label, icon: Icon }) => (
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

        {(mode === "image" || mode === "file" || mode === "audio") && (
          <div className="space-y-2">
            <div
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:border-primary/50 hover:bg-accent/20 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptMap[mode]}
                className="hidden"
                onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
              />
              {mediaFile ? (
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="truncate max-w-[200px]">{mediaFile.name}</span>
                  <button onClick={(e) => { e.stopPropagation(); setMediaFile(null); }} className="text-muted-foreground hover:text-destructive">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Click to select {mode}</p>
                </>
              )}
            </div>
            {mode !== "audio" && (
              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder={mode === "image" ? "Caption (optional)" : "Description (optional)"}
                className="text-sm"
              />
            )}
            <Button onClick={handleSend} disabled={!canSend()} className="w-full gap-2">
              {uploading ? (
                <><div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Uploading…</>
              ) : (
                <><Send className="h-4 w-4" /> Send {mode}</>
              )}
            </Button>
          </div>
        )}

        {mode === "template" && (
          <div className="space-y-3">
            <TemplateSelect
              botId={conversation?.sendpulse_bot_id}
              selectedName={templateName}
              onSelect={(t) => {
                setTemplateName(t.name);
                setTemplateLang(t.language || "en");
                setTemplateParams(t.paramCount > 0 ? Array(t.paramCount).fill("") : [""]);
              }}
            />
            <div className="space-y-1">
              <Label className="text-xs">Body Parameters (one per line, in order)</Label>
              <div className="space-y-1.5">
                {templateParams.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-6 text-right">{`{{${i + 1}}}`}</span>
                    <Input
                      value={p}
                      onChange={(e) => {
                        const next = [...templateParams];
                        next[i] = e.target.value;
                        setTemplateParams(next);
                      }}
                      placeholder={`Parameter ${i + 1}`}
                      className="text-sm flex-1"
                    />
                    {templateParams.length > 1 && (
                      <button onClick={() => setTemplateParams(templateParams.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => setTemplateParams([...templateParams, ""])} className="text-xs text-primary hover:underline">
                  + Add parameter
                </button>
              </div>
            </div>
            <Button onClick={handleSend} disabled={!canSend()} className="w-full gap-2">
              <Send className="h-4 w-4" /> Send Template
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}