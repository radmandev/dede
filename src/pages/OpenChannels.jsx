import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Cable, Zap, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const CHANNELS = ["whatsapp", "telegram", "instagram", "facebook", "live_chat"];
const empty = { name: "", bitrix24_account_id: "", sendpulse_account_id: "", bitrix24_line_id: "", sendpulse_bot_id: "", channel: "whatsapp" };

export default function OpenChannels() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);

  const { data: channels = [], isLoading } = useQuery({ queryKey: ["openChannels"], queryFn: () => base44.entities.Bitrix24OpenChannel.list("-created_date") });
  const { data: bxAccounts = [] } = useQuery({ queryKey: ["bitrix24Accounts"], queryFn: () => base44.entities.Bitrix24Account.list() });
  const { data: spAccounts = [] } = useQuery({ queryKey: ["sendpulseAccounts"], queryFn: () => base44.entities.SendPulseAccount.list() });

  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["bxLines", form.bitrix24_account_id],
    queryFn: async () => {
      const res = await base44.functions.invoke("bitrix24ListLines", { bitrix24_account_id: form.bitrix24_account_id });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data?.lines || [];
    },
    enabled: open && !!form.bitrix24_account_id,
  });

  const bxName = (id) => bxAccounts.find((a) => a.id === id)?.name || "—";
  const spName = (id) => spAccounts.find((a) => a.id === id)?.name || "—";

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editing) return base44.entities.Bitrix24OpenChannel.update(editing, data);
      return base44.entities.Bitrix24OpenChannel.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["openChannels"] });
      toast.success("Channel saved");
      setOpen(false); setForm(empty); setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Bitrix24OpenChannel.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["openChannels"] }); toast.success("Channel deleted"); },
  });

  const registerMutation = useMutation({
    mutationFn: async (id) => {
      const res = await base44.functions.invoke("bitrix24RegisterConnector", { openChannelId: id });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: (data) => toast.success(data.msg || "Connector registered"),
    onError: (err) => toast.error(err.message),
  });

  const openEdit = (ch) => {
    setEditing(ch.id);
    setForm({
      name: ch.name || "", bitrix24_account_id: ch.bitrix24_account_id || "", sendpulse_account_id: ch.sendpulse_account_id || "",
      bitrix24_line_id: ch.bitrix24_line_id || "", sendpulse_bot_id: ch.sendpulse_bot_id || "", channel: ch.channel || "whatsapp",
    });
    setOpen(true);
  };
  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Cable className="h-5 w-5" /> Open Channels</h1>
            <p className="text-sm text-muted-foreground mt-1">Map each Bitrix24 Open Line to a SendPulse account &amp; bot.</p>
          </div>
          <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Add Channel</Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>
        ) : channels.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No channels yet.</p>
        ) : (
          <div className="space-y-3">
            {channels.map((ch) => {
              const unmapped = !ch.sendpulse_account_id || !ch.sendpulse_bot_id;
              return (
                <Card key={ch.id}>
                  <CardContent className="py-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{ch.name}</p>
                        <Badge variant="secondary" className="capitalize">{ch.channel}</Badge>
                        {unmapped && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Needs mapping</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => registerMutation.mutate(ch.id)} disabled={registerMutation.isPending} className="gap-1">
                          <Zap className="h-3.5 w-3.5" /> Register
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(ch)}>Edit</Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(ch.id)} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <p>Bitrix24: <span className="text-foreground">{bxName(ch.bitrix24_account_id)}</span> · Line {ch.bitrix24_line_id || "—"}</p>
                      <p>SendPulse: <span className="text-foreground">{spName(ch.sendpulse_account_id)}</span></p>
                      <p>Bot ID: <span className="font-mono text-foreground">{ch.sendpulse_bot_id || "—"}</span></p>
                      <p>Connector: <span className="font-mono text-foreground">{ch.bitrix24_connector_id || "—"}</span></p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} Open Channel</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Channel Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Client A — WhatsApp" />
            </div>
            <div className="space-y-2">
              <Label>Bitrix24 Account</Label>
              <Select value={form.bitrix24_account_id} onValueChange={(v) => setForm({ ...form, bitrix24_account_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select Bitrix24 portal" /></SelectTrigger>
                <SelectContent>{bxAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>SendPulse Account</Label>
              <Select value={form.sendpulse_account_id} onValueChange={(v) => setForm({ ...form, sendpulse_account_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select SendPulse account" /></SelectTrigger>
                <SelectContent>{spAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Bitrix24 Open Line</Label>
                <Select value={form.bitrix24_line_id} onValueChange={(v) => setForm({ ...form, bitrix24_line_id: v })} disabled={!form.bitrix24_account_id || linesLoading}>
                  <SelectTrigger><SelectValue placeholder={!form.bitrix24_account_id ? "Pick a portal first" : linesLoading ? "Loading lines…" : "Select an open line"} /></SelectTrigger>
                  <SelectContent>{lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Channel Type</Label>
                <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>SendPulse Bot ID <span className="text-muted-foreground text-xs">(inbound routing key)</span></Label>
              <Input value={form.sendpulse_bot_id} onChange={(e) => setForm({ ...form, sendpulse_bot_id: e.target.value })} placeholder="The bot ID from SendPulse" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name || !form.bitrix24_account_id || !form.sendpulse_account_id || saveMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}