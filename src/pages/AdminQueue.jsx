import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ShieldCheck, RefreshCw, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function AdminQueue() {
  const queryClient = useQueryClient();

  const { data: conversations = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["adminQueue"],
    queryFn: () => base44.entities.Conversation.filter({ status: "pending" }, "-updated_date", 100),
  });

  const resolve = useMutation({
    mutationFn: (id) => base44.entities.Conversation.update(id, { status: "open" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminQueue"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Conversation marked as open");
    },
    onError: (err) => toast.error(err.message || "Failed to update"),
  });

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-2xl font-bold">Admin Queue</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Pending conversations requiring attention</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
            <CheckCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Queue is empty</p>
            <p className="text-sm mt-1">No pending conversations right now</p>
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((conv) => (
              <div key={conv.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{conv.contact_name || "Unknown"}</p>
                    <Badge variant="secondary" className="text-xs capitalize flex-shrink-0">{conv.channel}</Badge>
                  </div>
                  {conv.last_message_text && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{conv.last_message_text}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-4 flex-shrink-0"
                  onClick={() => resolve.mutate(conv.id)}
                  disabled={resolve.isPending}
                >
                  Mark open
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
