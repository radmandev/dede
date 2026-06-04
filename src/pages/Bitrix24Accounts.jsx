import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function Bitrix24Accounts() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "", webhook_token: "" });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["bitrix24Accounts"],
    queryFn: () => base44.entities.Bitrix24Account.list(),
  });

  const add = useMutation({
    mutationFn: (values) => base44.entities.Bitrix24Account.create(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bitrix24Accounts"] });
      setAddOpen(false);
      setForm({ name: "", domain: "", webhook_token: "" });
      toast.success("Account added");
    },
    onError: (err) => toast.error(err.message || "Failed to add account"),
  });

  const remove = useMutation({
    mutationFn: (id) => base44.entities.Bitrix24Account.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bitrix24Accounts"] });
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
            <h1 className="text-2xl font-bold">Bitrix24 Accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your Bitrix24 CRM connections</p>
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
            <p className="text-sm mt-1">Add your Bitrix24 account to enable CRM integration</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4">
                <div>
                  <p className="font-medium">{acc.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{acc.domain}</p>
                </div>
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
            ))}
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Bitrix24 Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Account name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Bitrix24" required />
            </div>
            <div className="space-y-1.5">
              <Label>Domain</Label>
              <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="mycompany.bitrix24.com" required />
            </div>
            <div className="space-y-1.5">
              <Label>Webhook token</Label>
              <Input type="password" value={form.webhook_token} onChange={(e) => setForm({ ...form, webhook_token: e.target.value })} placeholder="Inbound webhook token" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={add.isPending}>{add.isPending ? "Adding…" : "Add account"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
