import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Image, Video, FileText, Type, AlignLeft } from "lucide-react";

const HEADER_META = {
  IMAGE:    { label: "Image",    icon: Image,    color: "text-blue-500" },
  VIDEO:    { label: "Video",    icon: Video,    color: "text-purple-500" },
  DOCUMENT: { label: "Document", icon: FileText,  color: "text-amber-500" },
  TEXT:     { label: "Text hdr", icon: Type,      color: "text-muted-foreground" },
  NONE:     { label: "Text",     icon: AlignLeft, color: "text-muted-foreground" },
};

export function HeaderTypeBadge({ headerType }) {
  const meta = HEADER_META[headerType] || HEADER_META.NONE;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide ${meta.color}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export default function TemplateSelect({ botId, selectedName, onSelect }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["sp-templates", botId],
    queryFn: async () => {
      const res = await base44.functions.invoke("getSendPulseTemplates", { botId });
      return res.data?.templates || [];
    },
    enabled: !!botId,
  });

  const templates = data || [];
  const selectedTemplate = templates.find((t) => t.name === selectedName);

  // Auto-select first template once loaded
  const autoSelected = useRef(false);
  useEffect(() => {
    if (!autoSelected.current && templates.length > 0 && !selectedName) {
      autoSelected.current = true;
      onSelect(templates[0]);
    }
  }, [templates.length]); // eslint-disable-line

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Template</Label>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-xs text-primary hover:underline flex items-center gap-1"
          disabled={isFetching}
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Sync
        </button>
      </div>
      <Select
        value={selectedName || ""}
        onValueChange={(name) => {
          const t = templates.find((x) => x.name === name);
          if (t) onSelect(t);
        }}
        disabled={isLoading || templates.length === 0}
      >
        <SelectTrigger className="text-sm">
          {selectedTemplate ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate">{selectedTemplate.name}</span>
              <HeaderTypeBadge headerType={selectedTemplate.headerType} />
              <span className="text-xs text-muted-foreground uppercase flex-shrink-0">{selectedTemplate.language}</span>
            </div>
          ) : (
            <SelectValue placeholder={isLoading ? "Loading templates…" : "Select a template"} />
          )}
        </SelectTrigger>
        <SelectContent>
          {templates.map((t) => (
            <SelectItem key={t.name} value={t.name}>
              <div className="flex items-center gap-2">
                <span className="truncate">{t.name}</span>
                <HeaderTypeBadge headerType={t.headerType} />
                <span className="text-xs text-muted-foreground uppercase flex-shrink-0">{t.language}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isError && <p className="text-xs text-destructive">{error?.message || "Failed to load templates"}</p>}
      {!isLoading && !isError && templates.length === 0 && (
        <p className="text-xs text-muted-foreground">No approved templates found for this bot.</p>
      )}
    </div>
  );
}
