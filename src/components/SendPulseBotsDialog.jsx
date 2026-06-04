import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RefreshCw, Copy, Check, Bot } from "lucide-react";
import { toast } from "sonner";

const CHANNEL_LABELS = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  instagram: "Instagram",
  facebook: "Facebook",
  live_chat: "Live Chat",
};

export default function SendPulseBotsDialog({ account, open, onClose }) {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const { data: bots = [], isLoading } = useQuery({
    queryKey: ["sendpulseBots", account?.id],
    queryFn: () => base44.entities.SendPulseBot.filter({ sendpulse_account_id: account.id }),
    enabled: !!account?.id && open,
  });

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await base44.functions.invoke("sendpulseSyncBots", {
        sendpulse_account_id: account.id,
        origin: window.location.origin,
      });
      queryClient.invalidateQueries({ queryKey: ["sendpulseBots", account.id] });
      toast.success(`Synced ${res.data.count} bot(s) and registered webhooks`);
    } catch (err) {
      toast.error("Sync failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSyncing(false);
    }
  };

  const copyId = (id) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    toast.success("Bot ID copied!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Chatbots — {account?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Sync to fetch this account's chatbots from SendPulse and automatically register the webhook on each channel.
          </p>
          {isLoading ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>
          ) : bots.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No bots synced yet. Click Sync below.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {bots.map((b) => (
                <div key={b.id} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{b.name}</p>
                      <Badge variant="secondary" className="text-[10px]">{CHANNEL_LABELS[b.channel] || b.channel}</Badge>
                      {b.webhook_active && <Badge className="text-[10px] gap-1"><Check className="h-3 w-3" /> Webhook</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{b.bot_id}</p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => copyId(b.bot_id)} className="flex-shrink-0">
                    {copiedId === b.bot_id ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={sync} disabled={syncing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync Bots"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}