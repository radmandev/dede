import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plus, Trash2, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import SendPulseBotsDialog from "@/components/SendPulseBotsDialog";
import { toast } from "sonner";

export default function SendPulseAccounts() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [botsAccount, setBotsAccount] = useState(null);
  const [form, setForm] = useState({ name: "", client_id: "", client_secret: "" });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["sendpulseAccounts"],
    queryFn: () => base44.entities.SendPulseAccount.list(),
  });

  const add = useMutation({
    mutationFn: (values) => base44.entities.SendPulseAccount.create(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sendpulseAccounts"] });
      setAddOpen(false);
      setForm({ name: "", client_id: "", client_secret: "" });
      toast.success("Account added");
    },
    onError: (err) => toast.error(err.message || "Failed to add account"),
  });

  const remove = useMutation({
    mutationFn: (id) => base44.entities.SendPulseAccount.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sendpulseAccounts"] });
      toast.success("Account removed");
    },
    onError: (err) => toast.error(err.message || "Failed to remove account"),
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
            <h1 className="text-2xl font-bold">SendPulse Accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your SendPulse API credentials</p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add account
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
            <p className="font-medium">No accounts yet</p>
            <p className="text-sm mt-1">Add your first SendPulse account to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4">
                <div>
                  <p className="font-medium">{acc.name}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">ID: {acc.client_id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBotsAccount(acc)}>
                    <Bot className="h-4 w-4" /> Bots
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remove.mutate(acc.id)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add SendPulse Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Account name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My SendPulse" required />
            </div>
            <div className="space-y-1.5">
              <Label>Client ID</Label>
              <Input value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} placeholder="API client ID" required />
            </div>
            <div className="space-y-1.5">
              <Label>Client Secret</Label>
              <Input type="password" value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} placeholder="API client secret" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={add.isPending}>{add.isPending ? "Adding…" : "Add account"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SendPulseBotsDialog
        account={botsAccount}
        open={!!botsAccount}
        onClose={() => setBotsAccount(null)}
      />
    </div>
  );
}
