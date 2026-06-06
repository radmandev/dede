import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44, supabase } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Zap, ZapOff, Server, RefreshCw } from "lucide-react";
import { toast } from "sonner";

function OpenChannelsList({ accountId }) {
  const { data: channels = [], isLoading } = useQuery({
    queryKey: ["openChannelsByAccount", accountId],
    queryFn: () => base44.entities.Bitrix24OpenChannel.filter({ bitrix24_account_id: accountId }),
    enabled: !!accountId,
  });

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Open Channels</p>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : channels.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No open channels configured yet. Go to the{" "}
          <span className="font-medium text-foreground">Open Channels</span> page to add one, or open this connector from inside a Bitrix24 open line to auto-create it.
        </p>
      ) : (
        channels.map((ch) => (
          <div key={ch.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
            <div>
              <p className="text-sm font-medium">{ch.name}</p>
              <p className="text-xs text-muted-foreground font-mono">Line ID: {ch.bitrix24_line_id || "—"}</p>
            </div>
            <Badge variant="secondary" className="text-xs capitalize">{ch.channel || "channel"}</Badge>
          </div>
        ))
      )}
    </div>
  );
}

export default function Bitrix24Accounts() {
  const queryClient = useQueryClient();
  const { currentMembership } = useAuth();
  const orgId = currentMembership?.organization_id;

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["bitrix24Accounts"],
    queryFn: () => base44.entities.Bitrix24Account.list("-created_at"),
  });

  // Auto-claim unclaimed accounts: set owner_id to the current user's profile
  const claimMutation = useMutation({
    mutationFn: async (accountId) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const authUid = sessionData?.session?.user?.id;
      if (!authUid) return;
      const { data: profile } = await supabase.from("profiles").select("id").eq("auth_uid", authUid).limit(1).single();
      if (!profile?.id) return;
      const update = { owner_id: profile.id };
      if (orgId) update.organization_id = orgId;
      await supabase.from("bitrix24_accounts").update(update).eq("id", accountId).is("owner_id", null);
      await supabase.from("bitrix24_open_channels").update(update).eq("bitrix24_account_id", accountId).is("owner_id", null);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bitrix24Accounts"] }),
  });

  useEffect(() => {
    const unclaimed = accounts.filter((a) => !a.owner_id);
    unclaimed.forEach((a) => claimMutation.mutate(a.id));
  }, [accounts]);

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Bitrix24Account.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bitrix24Accounts"] });
      toast.success("Account removed");
    },
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-5 w-5" /> Bitrix24 Accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Portals appear here automatically once the app is activated inside Bitrix24.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-2">
              <Server className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">No portals connected yet</p>
              <p className="text-xs text-muted-foreground">
                Open the WhatsApp (SendPulse) connector inside Bitrix24 Contact Center to activate.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => (
              <Card key={acc.id}>
                <CardContent className="py-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{acc.name}</p>
                        <Badge
                          variant={acc.status === "connected" ? "default" : acc.status === "error" ? "destructive" : "secondary"}
                          className="gap-1"
                        >
                          {acc.status === "connected" ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
                          {acc.status === "connected" ? "Connected" : acc.status === "error" ? "Error" : "Not configured"}
                        </Badge>
                        {!acc.owner_id && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Claiming…</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1 truncate">{acc.domain || "no endpoint"}</p>
                      {acc.member_id && <p className="text-xs text-muted-foreground">member: {acc.member_id}</p>}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(acc.id)}
                      disabled={deleteMutation.isPending}
                      className="text-destructive flex-shrink-0 ml-2"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <OpenChannelsList accountId={acc.id} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
