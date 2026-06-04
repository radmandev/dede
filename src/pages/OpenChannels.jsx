import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plus, Trash2, Cable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const CHANNEL_OPTIONS = [
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "live_chat", label: "Live Chat" },
];

export default function OpenChannels() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", channel: "telegram", bitrix24_account_id: "", sendpulse_bot_id: "" });

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ["openChannels"],
    queryFn: () => base44.entities.Bitrix24OpenChannel.list(),
  });

  const { data: b24Accounts = [] } = useQuery({
    queryKey: ["bitrix24Accounts"],
    queryFn: () => base44.entities.Bitrix24Account.list(),
  });

  const add = useMutation({
    mutationFn: (values) => base44.entities.Bitrix24OpenChannel.create(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["openChannels"] });
      setAddOpen(false);
      setForm({ name: "", channel: "telegram", bitrix24_account_id: "", sendpulse_bot_id: "" });
      toast.success("Channel added");
    },
    onError: (err) => toast.error(err.message || "Failed to add channel"),
  });

  const remove = useMutation({
    mutationFn: (id) => base44.entities.Bitrix24OpenChannel.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["openChannels"] });
      toast.success("Channel removed");
    },
    onError: (err) => toast.error(err.message || "Failed to remove channel"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    add.mutate(form);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Open Channels</h1>
            <p className="text-sm text-muted-foreground mt-1">Connect SendPulse bots to Bitrix24 open channels</p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add channel
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : channels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
            <Cable className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No channels yet</p>
            <p className="text-sm mt-1">Add a channel to route messages to Bitrix24</p>
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{ch.name}</p>
                    <Badge variant="secondary" className="text-xs capitalize">{ch.channel}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Bot ID: {ch.sendpulse_bot_id || "—"}</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate(ch.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Open Channel</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Channel name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. WhatsApp Support" required />
            </div>
            <div className="space-y-1.5">
              <Label>Messenger</Label>
              <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANNEL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Bitrix24 Account</Label>
              <Select value={form.bitrix24_account_id} onValueChange={(v) => setForm({ ...form, bitrix24_account_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {b24Accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>SendPulse Bot ID</Label>
              <Input value={form.sendpulse_bot_id} onChange={(e) => setForm({ ...form, sendpulse_bot_id: e.target.value })} placeholder="Bot ID from SendPulse" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={add.isPending}>{add.isPending ? "Adding…" : "Add channel"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
