import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44, supabase } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Zap, ZapOff, Server, RefreshCw, Link2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const CHANNEL_LABELS = {
  whatsapp: "WhatsApp", telegram: "Telegram", instagram: "Instagram",
  facebook: "Facebook", live_chat: "Live Chat",
};

function ChannelRow({ channel, allBots, onConnect }) {
  const botForChannel = allBots.filter(
    (b) => !channel.channel || b.channel === channel.channel
  );
  const [selectedBot, setSelectedBot] = useState(channel.sendpulse_bot_id || "");
  const [saving, setSaving] = useState(false);

  const isMapped = !!channel.sendpulse_bot_id;
  const isDirty = selectedBot !== (channel.sendpulse_bot_id || "");

  const handleConnect = async () => {
    if (!selectedBot) { toast.error("Select a bot first"); return; }
    setSaving(true);
    try {
      await onConnect(channel.id, selectedBot);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">{channel.name}</p>
          <Badge variant="secondary" className="text-[10px]">
            {CHANNEL_LABELS[channel.channel] || channel.channel}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">Line {channel.bitrix24_line_id || "—"}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Bot selector */}
        <Select value={selectedBot} onValueChange={setSelectedBot}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder={botForChannel.length ? "Select bot…" : "No bots"} />
          </SelectTrigger>
          <SelectContent>
            {botForChannel.map((b) => (
              <SelectItem key={b.id} value={b.id} className="text-xs">
                {b.name || b.bot_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Connect button */}
        <Button
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={handleConnect}
          disabled={saving || !selectedBot || !isDirty}
          variant={isMapped && !isDirty ? "outline" : "default"}
        >
          {saving ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : isMapped && !isDirty ? (
            <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Connected</>
          ) : (
            <><Link2 className="h-3 w-3" /> Connect</>
          )}
        </Button>
      </div>
    </div>
  );
}

function AccountCard({ account, allBots, queryClient, onDelete }) {
  const [syncing, setSyncing] = useState(false);

  const { data: channels = [], isLoading: channelsLoading, refetch: refetchChannels } = useQuery({
    queryKey: ["b24Channels", account.id],
    queryFn: () => base44.entities.Bitrix24OpenChannel.filter({ bitrix24_account_id: account.id }),
  });

  const syncLines = async () => {
    setSyncing(true);
    try {
      const res = await base44.functions.invoke("bitrix24ListLines", {
        bitrix24_account_id: account.id,
      });
      const lines = res.data?.lines || [];
      // Refetch now — bitrix24ListLines may have repaired organization_id on existing channels
      const { data: freshChannels } = await refetchChannels();
      const currentChannels = Array.isArray(freshChannels) ? freshChannels : channels;
      let created = 0;
      for (const line of lines) {
        const exists = currentChannels.find((ch) => ch.bitrix24_line_id === String(line.id));
        if (!exists) {
          const { error } = await supabase.from("bitrix24_open_channels").insert({
            bitrix24_account_id: account.id,
            bitrix24_line_id: String(line.id),
            name: line.name || `Line ${line.id}`,
            owner_id: account.owner_id || null,
            organization_id: account.organization_id || null,
            channel: "whatsapp",
            status: "active",
          });
          if (!error) created++;
        }
      }
      await refetchChannels();
      queryClient.invalidateQueries({ queryKey: ["b24Channels", account.id] });
      toast.success(
        created > 0
          ? `${created} new line(s) added`
          : lines.length > 0
          ? "All lines already synced"
          : "No open lines found. Open the connector inside a Bitrix24 open line to add one."
      );
    } catch (err) {
      toast.error("Sync failed: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const connectBot = async (channelId, botId) => {
    const bot = allBots.find((b) => b.id === botId);
    const { error } = await supabase.from("bitrix24_open_channels").update({
      sendpulse_bot_id: botId,
      sendpulse_account_id: bot?.sendpulse_account_id || null,
    }).eq("id", channelId);
    if (error) throw error;

    const res = await base44.functions.invoke("bitrix24RegisterConnector", {
      openChannelId: channelId,
    });
    if (res.data?.error) throw new Error(res.data.error);

    queryClient.invalidateQueries({ queryKey: ["b24Channels", account.id] });
    toast.success("Bot connected and connector registered ✓");
  };

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        {/* Account header */}
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold">{account.name}</p>
              <Badge
                variant={
                  account.status === "connected"
                    ? "default"
                    : account.status === "error"
                    ? "destructive"
                    : "secondary"
                }
                className="gap-1"
              >
                {account.status === "connected" ? (
                  <Zap className="h-3 w-3" />
                ) : (
                  <ZapOff className="h-3 w-3" />
                )}
                {account.status === "connected"
                  ? "Connected"
                  : account.status === "error"
                  ? "Error"
                  : "Not configured"}
              </Badge>
              {!account.owner_id && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                  Claiming…
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
              {account.domain || "no endpoint"}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              onClick={syncLines}
              disabled={syncing}
            >
              <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync Lines"}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive"
              onClick={() => onDelete(account.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Open Channels */}
        <div className="space-y-2 pt-1 border-t">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Open Channels
          </p>

          {channelsLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <RefreshCw className="h-3 w-3 animate-spin" /> Loading…
            </div>
          ) : channels.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-3 text-center space-y-1">
              <p className="text-xs text-muted-foreground">No open channels yet.</p>
              <p className="text-xs text-muted-foreground">
                Open this connector from a Bitrix24 open line, or click{" "}
                <span className="font-medium text-foreground">Sync Lines</span>.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {channels.map((ch) => (
                <ChannelRow
                  key={ch.id}
                  channel={ch}
                  allBots={allBots}
                  onConnect={connectBot}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
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

  const { data: allBots = [] } = useQuery({
    queryKey: ["allBots"],
    queryFn: () => base44.entities.SendPulseBot.list(),
  });

  // Auto-claim unclaimed accounts (set owner_id + organization_id)
  const claimMutation = useMutation({
    mutationFn: async (accountId) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const authUid = sessionData?.session?.user?.id;
      if (!authUid) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("auth_uid", authUid)
        .limit(1)
        .single();
      if (!profile?.id) return;
      const update = { owner_id: profile.id };
      if (orgId) update.organization_id = orgId;
      await supabase.from("bitrix24_accounts").update(update).eq("id", accountId).is("owner_id", null);
      await supabase.from("bitrix24_open_channels").update(update).eq("bitrix24_account_id", accountId).is("owner_id", null);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bitrix24Accounts"] }),
  });

  useEffect(() => {
    accounts.filter((a) => !a.owner_id).forEach((a) => claimMutation.mutate(a.id));
  }, [accounts]);

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Bitrix24Account.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bitrix24Accounts"] });
      toast.success("Portal removed");
    },
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-5 w-5" /> Bitrix24 Portals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage connected Bitrix24 portals and map SendPulse bots to open channels.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <Card>
            <CardContent className="py-10 space-y-4">
              <div className="text-center space-y-2">
                <Server className="h-8 w-8 mx-auto text-muted-foreground/40" />
                <p className="text-sm font-medium">No portals connected yet</p>
              </div>
              <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                <li>Install the <strong className="text-foreground">WhatsApp (SendPulse)</strong> app from the Bitrix24 Marketplace.</li>
                <li>Open the app — it will appear here automatically once activated.</li>
                <li>Click <strong className="text-foreground">Sync Lines</strong> to import your open lines.</li>
                <li>Or open the connector inside a Bitrix24 open line to register a channel.</li>
                <li>Select a bot for each channel and click <strong className="text-foreground">Connect</strong>.</li>
              </ol>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {accounts.map((acc) => (
              <AccountCard
                key={acc.id}
                account={acc}
                allBots={allBots}
                queryClient={queryClient}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
