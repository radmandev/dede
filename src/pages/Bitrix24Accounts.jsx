import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44, supabase } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Zap, ZapOff, Server, Radio, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

function OpenChannelsList({ accountId }) {
  const [lines, setLines] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchLines = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("bitrix24ListLines", { bitrix24_account_id: accountId });
      if (res.data?.error) throw new Error(res.data.error);
      setLines(res.data?.lines || []);
    } catch (e) {
      toast.error("Failed to fetch channels: " + e.message);
      setLines([]);
    } finally {
      setLoading(false);
    }
  };

  if (lines === null) {
    return (
      <Button size="sm" variant="outline" onClick={fetchLines} disabled={loading} className="gap-1.5 mt-2">
        {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
        View Open Channels
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Open Channels</p>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={fetchLines} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">No open channels found in this portal.</p>
      ) : (
        lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
            <div>
              <p className="text-sm font-medium">{line.name}</p>
              <p className="text-xs text-muted-foreground font-mono">Line ID: {line.id}</p>
            </div>
            <Badge variant="secondary" className="text-xs">Open Channel</Badge>
          </div>
        ))
      )}
    </div>
  );
}

export default function Bitrix24Accounts() {
  const queryClient = useQueryClient();

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
      await supabase.from("bitrix24_accounts").update({ owner_id: profile.id }).eq("id", accountId).is("owner_id", null);
      await supabase.from("bitrix24_open_channels").update({ owner_id: profile.id }).eq("bitrix24_account_id", accountId).is("owner_id", null);
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
