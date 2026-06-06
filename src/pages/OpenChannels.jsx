import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Cable, Zap, AlertTriangle, ChevronRight, Info } from "lucide-react";
import { toast } from "sonner";

const CHANNELS = ["whatsapp", "telegram", "instagram", "facebook", "live_chat"];
const CHANNEL_LABELS = { whatsapp: "WhatsApp", telegram: "Telegram", instagram: "Instagram", facebook: "Facebook", live_chat: "Live Chat" };

const DEFAULT_SETTINGS = {
  // Show messages in open channels sent from
  show_from_sendpulse_dialog: true,
  show_from_mobile_app: true,
  show_from_native_messenger: true,
  show_from_personal_cabinet: false,
  show_from_api: false,
  show_from_bot: false,
  // Chat settings
  enable_group_messages: false,
  show_phone_in_group_chats: false,
  enable_auto_replies_group: false,
  auto_sync_chat_name: false,
  force_disable_chat_tracker: true,
  mark_as_read_on_send: false,
  // CRM
  exclude_duplicates_in_crm: false,
  // Sync to responsible
  sync_crm_to_sp_lead: false,
  sync_crm_to_sp_deal: false,
  sync_crm_to_sp_contact: false,
  sync_crm_to_sp_company: false,
  sync_sp_to_crm_lead: false,
  sync_sp_to_crm_deal: false,
  sync_sp_to_crm_contact: false,
  sync_sp_to_crm_company: false,
};

const emptyForm = {
  name: "",
  bitrix24_account_id: "",
  sendpulse_account_id: "",
  bitrix24_line_id: "",
  sendpulse_bot_id: "",
  channel: "whatsapp",
  settings: DEFAULT_SETTINGS,
};

function SectionHeader({ title, children }) {
  return (
    <div className="py-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function CheckRow({ id, label, checked, onCheckedChange }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <label htmlFor={id} className="text-sm cursor-pointer select-none">{label}</label>
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between py-3 text-sm font-semibold text-foreground hover:text-primary transition-colors">
          {title}
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export default function OpenChannels() {
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ["openChannels"],
    queryFn: () => base44.entities.Bitrix24OpenChannel.list("-created_date"),
  });
  const { data: bxAccounts = [] } = useQuery({ queryKey: ["bitrix24Accounts"], queryFn: () => base44.entities.Bitrix24Account.list() });
  const { data: spAccounts = [] } = useQuery({ queryKey: ["sendpulseAccounts"], queryFn: () => base44.entities.SendPulseAccount.list() });

  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["bxLines", form.bitrix24_account_id],
    queryFn: async () => {
      const res = await base44.functions.invoke("bitrix24ListLines", { bitrix24_account_id: form.bitrix24_account_id });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data?.lines || [];
    },
    enabled: sheetOpen && !!form.bitrix24_account_id,
  });

  const { data: bots = [] } = useQuery({
    queryKey: ["sendpulseBots", form.sendpulse_account_id],
    queryFn: () => base44.entities.SendPulseBot.filter({ sendpulse_account_id: form.sendpulse_account_id }),
    enabled: sheetOpen && !!form.sendpulse_account_id,
  });

  const bxName = (id) => bxAccounts.find((a) => a.id === id)?.name || "—";
  const spName = (id) => spAccounts.find((a) => a.id === id)?.name || "—";

  const setSetting = (key, value) =>
    setForm((f) => ({ ...f, settings: { ...f.settings, [key]: value } }));

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editing) return base44.entities.Bitrix24OpenChannel.update(editing, data);
      return base44.entities.Bitrix24OpenChannel.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["openChannels"] });
      toast.success("Channel saved");
      setSheetOpen(false);
      setForm(emptyForm);
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Bitrix24OpenChannel.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["openChannels"] });
      toast.success("Channel deleted");
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (id) => {
      const res = await base44.functions.invoke("bitrix24RegisterConnector", { openChannelId: id });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: (data, id) => {
      toast.success(data.msg || "Connector registered");
      setSheetOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const openEdit = (ch) => {
    setEditing(ch.id);
    setForm({
      name: ch.name || "",
      bitrix24_account_id: ch.bitrix24_account_id || "",
      sendpulse_account_id: ch.sendpulse_account_id || "",
      bitrix24_line_id: ch.bitrix24_line_id || "",
      sendpulse_bot_id: ch.sendpulse_bot_id || "",
      channel: ch.channel || "whatsapp",
      settings: { ...DEFAULT_SETTINGS, ...(ch.settings || {}) },
    });
    setSheetOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setSheetOpen(true);
  };

  const handleSaveAndConnect = async () => {
    const saved = await saveMutation.mutateAsync(form);
    if (saved?.id) {
      await registerMutation.mutateAsync(saved.id);
    }
  };

  const s = form.settings;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Cable className="h-5 w-5" /> Open Channels
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Map each Bitrix24 Open Line to a SendPulse account &amp; bot.
            </p>
          </div>
          <Button onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" /> Add Channel
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{ch.name}</p>
                        <Badge variant="secondary" className="capitalize">
                          {CHANNEL_LABELS[ch.channel] || ch.channel}
                        </Badge>
                        {unmapped && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> Needs mapping
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => registerMutation.mutate(ch.id)}
                          disabled={registerMutation.isPending}
                          className="gap-1"
                        >
                          <Zap className="h-3.5 w-3.5" /> Register
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(ch)}>
                          Configure
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(ch.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
          <SheetHeader className="px-6 py-4 border-b sticky top-0 bg-background z-10">
            <SheetTitle className="text-base">
              {editing ? "Configure Open Channel" : "Add Open Channel"}
            </SheetTitle>
          </SheetHeader>

          <div className="px-6 pb-8 space-y-0">

            {/* ── Channel Name ── */}
            <div className="py-4 border-b space-y-2">
              <Label>Channel Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Client A — WhatsApp"
              />
            </div>

            {/* ── Account (SendPulse) ── */}
            <div className="py-4 border-b space-y-3">
              <SectionHeader title="* Account" />

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">SendPulse Account</Label>
                <Select
                  value={form.sendpulse_account_id}
                  onValueChange={(v) => setForm({ ...form, sendpulse_account_id: v, sendpulse_bot_id: "" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select SendPulse account" />
                  </SelectTrigger>
                  <SelectContent>
                    {spAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Channel Type</Label>
                  <Select
                    value={form.channel}
                    onValueChange={(v) => setForm({ ...form, channel: v, sendpulse_bot_id: "" })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((c) => (
                        <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Bot</Label>
                  <Select
                    value={form.sendpulse_bot_id}
                    onValueChange={(v) => setForm({ ...form, sendpulse_bot_id: v })}
                    disabled={!form.sendpulse_account_id}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={!form.sendpulse_account_id ? "Pick account first" : "Select bot"} />
                    </SelectTrigger>
                    <SelectContent>
                      {bots
                        .filter((b) => !form.channel || b.channel === form.channel)
                        .map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name || b.bot_id}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* ── Open Channel and permissions ── */}
            <div className="py-4 border-b space-y-3">
              <SectionHeader title="Open Channel and permissions" />

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Bitrix24 Portal</Label>
                <Select
                  value={form.bitrix24_account_id}
                  onValueChange={(v) => setForm({ ...form, bitrix24_account_id: v, bitrix24_line_id: "" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Bitrix24 portal" />
                  </SelectTrigger>
                  <SelectContent>
                    {bxAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Open Line</Label>
                <Select
                  value={form.bitrix24_line_id}
                  onValueChange={(v) => setForm({ ...form, bitrix24_line_id: v })}
                  disabled={!form.bitrix24_account_id || linesLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !form.bitrix24_account_id
                          ? "Pick a portal first"
                          : linesLoading
                          ? "Loading lines…"
                          : "Select an open line"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {lines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Show messages in open channels sent from ── */}
            <div className="py-2 border-b">
              <CollapsibleSection title="Show messages in open channels sent from" defaultOpen={true}>
                <div className="space-y-0.5">
                  <CheckRow id="show_from_sendpulse_dialog" label="SendPulse Dialog" checked={s.show_from_sendpulse_dialog} onCheckedChange={(v) => setSetting("show_from_sendpulse_dialog", v)} />
                  <CheckRow id="show_from_mobile_app" label="Mobile application SendPulse" checked={s.show_from_mobile_app} onCheckedChange={(v) => setSetting("show_from_mobile_app", v)} />
                  <CheckRow id="show_from_native_messenger" label="Native messenger app" checked={s.show_from_native_messenger} onCheckedChange={(v) => setSetting("show_from_native_messenger", v)} />
                  <CheckRow id="show_from_personal_cabinet" label="Personal cabinet SendPulse" checked={s.show_from_personal_cabinet} onCheckedChange={(v) => setSetting("show_from_personal_cabinet", v)} />
                  <CheckRow id="show_from_api" label="SendPulse API (your application)" checked={s.show_from_api} onCheckedChange={(v) => setSetting("show_from_api", v)} />
                  <CheckRow id="show_from_bot" label="SendPulse Bot" checked={s.show_from_bot} onCheckedChange={(v) => setSetting("show_from_bot", v)} />
                </div>
              </CollapsibleSection>
            </div>

            {/* ── Chat settings ── */}
            <div className="py-2 border-b">
              <CollapsibleSection title="Chat settings" defaultOpen={true}>
                <div className="space-y-0.5">
                  <CheckRow id="enable_group_messages" label="Enable group chat messages" checked={s.enable_group_messages} onCheckedChange={(v) => setSetting("enable_group_messages", v)} />
                  <CheckRow id="show_phone_in_group_chats" label="Show phone numbers in open lines group chats" checked={s.show_phone_in_group_chats} onCheckedChange={(v) => setSetting("show_phone_in_group_chats", v)} />
                  <CheckRow id="enable_auto_replies_group" label="Enable auto replies in open lines group chats" checked={s.enable_auto_replies_group} onCheckedChange={(v) => setSetting("enable_auto_replies_group", v)} />
                  <CheckRow id="auto_sync_chat_name" label="Auto-sync open line chat name with CRM contact name" checked={s.auto_sync_chat_name} onCheckedChange={(v) => setSetting("auto_sync_chat_name", v)} />
                  <CheckRow id="force_disable_chat_tracker" label="Force disable chat tracker" checked={s.force_disable_chat_tracker} onCheckedChange={(v) => setSetting("force_disable_chat_tracker", v)} />
                  <CheckRow id="mark_as_read_on_send" label="Mark a chat as read in SendPulse Dialog when sending a message through an open line" checked={s.mark_as_read_on_send} onCheckedChange={(v) => setSetting("mark_as_read_on_send", v)} />
                </div>
              </CollapsibleSection>
            </div>

            {/* ── Exclude duplicates in CRM ── */}
            <div className="py-2 border-b">
              <CollapsibleSection title="Exclude duplicates in CRM">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm">Enable deduplication</span>
                  <Switch
                    checked={s.exclude_duplicates_in_crm}
                    onCheckedChange={(v) => setSetting("exclude_duplicates_in_crm", v)}
                  />
                </div>
              </CollapsibleSection>
            </div>

            {/* ── Synchronization to responsible ── */}
            <div className="py-2 border-b">
              <CollapsibleSection title="Synchronization to responsible">
                <div className="space-y-4">
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-1">
                    <p>It is not recommended to enable synchronization to responsible unnecessarily.</p>
                    <p>A large number of CRM events can slow down performance on your portal. Only include the types of CRM cards you need.</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                    <p>For synchronisation to work, in the settings of the open line you need to enable "Check client against CRM database", as well as select "Automatically create a new lead" or "Automatically create a deal" for the "If client is not found in CRM" option.</p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From CRM to SendPulse</p>
                    <div className="grid grid-cols-2 gap-1">
                      <CheckRow id="sync_crm_to_sp_lead" label="Lead" checked={s.sync_crm_to_sp_lead} onCheckedChange={(v) => setSetting("sync_crm_to_sp_lead", v)} />
                      <CheckRow id="sync_crm_to_sp_deal" label="Deal" checked={s.sync_crm_to_sp_deal} onCheckedChange={(v) => setSetting("sync_crm_to_sp_deal", v)} />
                      <CheckRow id="sync_crm_to_sp_contact" label="Contact" checked={s.sync_crm_to_sp_contact} onCheckedChange={(v) => setSetting("sync_crm_to_sp_contact", v)} />
                      <CheckRow id="sync_crm_to_sp_company" label="Company" checked={s.sync_crm_to_sp_company} onCheckedChange={(v) => setSetting("sync_crm_to_sp_company", v)} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From SendPulse to CRM</p>
                    <div className="grid grid-cols-2 gap-1">
                      <CheckRow id="sync_sp_to_crm_lead" label="Lead" checked={s.sync_sp_to_crm_lead} onCheckedChange={(v) => setSetting("sync_sp_to_crm_lead", v)} />
                      <CheckRow id="sync_sp_to_crm_deal" label="Deal" checked={s.sync_sp_to_crm_deal} onCheckedChange={(v) => setSetting("sync_sp_to_crm_deal", v)} />
                      <CheckRow id="sync_sp_to_crm_contact" label="Contact" checked={s.sync_sp_to_crm_contact} onCheckedChange={(v) => setSetting("sync_sp_to_crm_contact", v)} />
                      <CheckRow id="sync_sp_to_crm_company" label="Company" checked={s.sync_sp_to_crm_company} onCheckedChange={(v) => setSetting("sync_sp_to_crm_company", v)} />
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            </div>

            {/* ── Save and connect ── */}
            <div className="pt-6 flex gap-3">
              <Button
                className="flex-1"
                onClick={handleSaveAndConnect}
                disabled={
                  !form.name ||
                  !form.bitrix24_account_id ||
                  !form.sendpulse_account_id ||
                  saveMutation.isPending ||
                  registerMutation.isPending
                }
              >
                {saveMutation.isPending || registerMutation.isPending ? "Saving…" : "Save and connect"}
              </Button>
              {editing && (
                <Button
                  variant="outline"
                  onClick={() => saveMutation.mutate(form)}
                  disabled={saveMutation.isPending}
                >
                  Save only
                </Button>
              )}
            </div>

            {editing && (
              <div className="pt-3">
                <Button
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    deleteMutation.mutate(editing);
                    setSheetOpen(false);
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
