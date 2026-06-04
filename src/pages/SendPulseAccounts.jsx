import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Zap, ZapOff, Copy, Check, Send, Bot } from "lucide-react";
import { toast } from "sonner";
import SendPulseBotsDialog from "../components/SendPulseBotsDialog";

const empty = { name: "", client_id: "", client_secret: "" };

export default function SendPulseAccounts() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [copied, setCopied] = useState(false);
  const [botAccount, setBotAccount] = useState(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["sendpulseAccounts"],
    queryFn: () => base44.entities.SendPulseAccount.list("-created_date"),
  });

  const webhookUrl = `${window.location.origin}/api/functions/sendpulseWebhook`;

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editing) return base44.entities.SendPulseAccount.update(editing, data);
      return base44.entities.SendPulseAccount.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sendpulseAccounts"] });
      toast.success("Account saved");
      setOpen(false);
      setForm(empty);
      setEditing(null);
    },
    onError: (err) => {
      toast.error("Failed to save: " + (err.message || "Unknown error"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.SendPulseAccount.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sendpulseAccounts"] });
      toast.success("Account deleted");
    },
  });

  const testConnection = useMutation({
    mutationFn: async (acc) => {
      const res = await fetch("https://api.sendpulse.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_id: acc.client_id, client_secret: acc.client_secret }),
      });
      const data = await res.json();
      if (!data.access_token) throw new Error(data.error_description || data.error || "Auth failed");
      await base44.entities.SendPulseAccount.update(acc.id, {
        access_token: data.access_token,
        token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        status: "connected",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sendpulseAccounts"] });
      toast.success("Connected to SendPulse!");
    },
    onError: (err, acc) => {
      base44.entities.SendPulseAccount.update(acc.id, { status: "error" });
      queryClient.invalidateQueries({ queryKey: ["sendpulseAccounts"] });
      toast.error("Connection failed: " + err.message);
    },
  });

  const openEdit = (acc) => {
    setEditing(acc.id);
    setForm({ name: acc.name || "", client_id: acc.client_id || "", client_secret: acc.client_secret || "" });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success("Webhook URL copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Send className="h-5 w-5" /> SendPulse Accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">Connect one or more SendPulse accounts.</p>
          </div>
          <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Add Account</Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Webhook URL (same for all accounts)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-muted rounded-lg px-4 py-2.5 text-sm font-mono break-all select-all">{webhookUrl}</div>
              <Button variant="outline" size="icon" onClick={copyUrl} className="flex-shrink-0">
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Register this URL in each SendPulse bot's webhook settings. Inbound messages are routed by the bot's ID configured on the matching Open Channel.</p>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No SendPulse accounts yet.</p>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => (
              <Card key={acc.id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{acc.name}</p>
                      <Badge variant={acc.status === "connected" ? "default" : acc.status === "error" ? "destructive" : "secondary"} className="gap-1">
                        {acc.status === "connected" ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
                        {acc.status === "connected" ? "Connected" : acc.status === "error" ? "Error" : "Not connected"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-1">{acc.client_id ? acc.client_id.substring(0, 12) + "…" : "no client id"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => testConnection.mutate(acc)} disabled={testConnection.isPending} className="gap-1">
                      <Zap className="h-3.5 w-3.5" /> Test
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setBotAccount(acc)} className="gap-1">
                      <Bot className="h-3.5 w-3.5" /> Bots
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(acc)}>Edit</Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(acc.id)} className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} SendPulse Account</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Account Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Client A WhatsApp" />
            </div>
            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} placeholder="SendPulse Client ID" />
            </div>
            <div className="space-y-2">
              <Label>Client Secret</Label>
              <Input type="password" value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} placeholder="SendPulse Client Secret" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name || saveMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {botAccount && (
        <SendPulseBotsDialog account={botAccount} open={!!botAccount} onClose={() => setBotAccount(null)} />
      )}
    </div>
  );
}