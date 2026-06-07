import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44, supabase } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Phone, User } from "lucide-react";
import { toast } from "sonner";

export default function NewChatDialog({ open, onClose, onConversationCreated, defaultPhone = "" }) {
  const { currentMembership } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [botId, setBotId] = useState("");

  // Pre-fill phone from CRM entity when dialog opens
  useEffect(() => {
    if (open && defaultPhone) setPhone(defaultPhone);
  }, [open, defaultPhone]);
  const [submitting, setSubmitting] = useState(false);

  const { data: bots = [] } = useQuery({
    queryKey: ["whatsappBots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sendpulse_bots")
        .select("*")
        .eq("channel", "whatsapp");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!phone.trim()) { toast.error("Phone number is required"); return; }
    if (!botId) { toast.error("Select a WhatsApp bot"); return; }
    setSubmitting(true);
    try {
      const res = await base44.functions.invoke("createSendPulseContact", {
        botId,
        name: name.trim() || phone.trim(),
        phone: phone.trim(),
      });
      const conv = res.data?.conversation;
      if (!conv) throw new Error(res.data?.error || "Failed to create conversation");
      toast.success("Conversation started");
      onConversationCreated(conv);
      handleClose();
    } catch (err) {
      toast.error(err.message || "Failed to create contact");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setName("");
    setPhone("");
    setBotId("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Conversation</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="nc-name" className="text-sm">Name <span className="text-muted-foreground">(optional)</span></Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="nc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contact name"
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nc-phone" className="text-sm">Phone number <span className="text-destructive">*</span></Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="nc-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1234567890"
                className="pl-9"
                type="tel"
                dir="ltr"
              />
            </div>
            <p className="text-xs text-muted-foreground">Include country code, e.g. +966XXXXXXXXX</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">WhatsApp bot <span className="text-destructive">*</span></Label>
            <Select value={botId} onValueChange={setBotId} disabled={bots.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={bots.length === 0 ? "No bots available" : "Select a bot"} />
              </SelectTrigger>
              <SelectContent>
                {bots.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name || b.bot_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 gap-2" disabled={submitting || !phone.trim() || !botId}>
              {submitting ? (
                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {submitting ? "Creating…" : "Start Conversation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
