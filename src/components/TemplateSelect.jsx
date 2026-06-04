import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

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
          <SelectValue placeholder={isLoading ? "Loading templates…" : "Select a template"} />
        </SelectTrigger>
        <SelectContent>
          {templates.map((t) => (
            <SelectItem key={t.name} value={t.name}>
              <span className="flex items-center gap-2">
                <span>{t.name}</span>
                <span className="text-xs text-muted-foreground uppercase">{t.language}</span>
              </span>
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