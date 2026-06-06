import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Check, Save, Settings as SettingsIcon, Webhook, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const queryClient = useQueryClient();
  const [appBaseUrl, setAppBaseUrl] = useState("");
  const [b24ClientId, setB24ClientId] = useState("");
  const [b24ClientSecret, setB24ClientSecret] = useState("");
  const [copiedInstaller, setCopiedInstaller] = useState(false);
  const [copiedHandler, setCopiedHandler] = useState(false);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["globalConfig"],
    queryFn: () => base44.entities.GlobalConfig.list(),
  });
  const config = configs[0];

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    setAppBaseUrl(config?.app_base_url || window.location.origin);
    setB24ClientId(config?.bitrix24_app_client_id || "");
    setB24ClientSecret(config?.bitrix24_app_client_secret || "");
  }, [config]);

  const saveConfig = useMutation({
    mutationFn: async (data) => {
      if (config) return base44.entities.GlobalConfig.update(config.id, data);
      return base44.entities.GlobalConfig.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["globalConfig"] });
      toast.success("Settings saved");
    },
  });

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://joiodrhhvhxmushujxze.supabase.co';
  const installerUrl = `${supabaseUrl}/functions/v1/bitrix24Installer`;
  const handlerUrl = `${supabaseUrl}/functions/v1/bitrix24Handler`;

  const rebindPlacements = useMutation({
    mutationFn: () => base44.functions.invoke("bitrix24RebindPlacements", {}),
    onSuccess: (res) => {
      const results = res?.data?.results || [];
      const okCount = results.filter((r) => r.ok).length;
      if (okCount > 0) toast.success(`Placements re-registered on ${okCount} portal(s).`);
      else toast.error(res?.data?.error || "Could not re-register placements.");
    },
    onError: (e) => toast.error(e?.message || "Failed to re-register placements."),
  });

  const bindWebhook = useMutation({
    mutationFn: () => base44.functions.invoke("bitrix24BindReplyWebhook", {}),
    onSuccess: (res) => {
      const results = res?.data?.results || [];
      const okCount = results.filter((r) => r.ok).length;
      if (okCount > 0) toast.success(`Reply webhook connected on ${okCount} portal(s).`);
      else toast.error(res?.data?.error || "Could not connect the reply webhook.");
    },
    onError: (e) => toast.error(e?.message || "Failed to connect the reply webhook."),
  });

  const copyUrl = (text, setFn) => {
    navigator.clipboard.writeText(text);
    setFn(true);
    toast.success("URL copied!");
    setTimeout(() => setFn(false), 2000);
  };

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto py-8 px-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><SettingsIcon className="h-5 w-5" /> Global Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Settings shared across all connected portals and accounts.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">App Production URL</CardTitle>
            <CardDescription>The public URL of this app (no trailing slash). Used to build the Bitrix24 webhook URLs. Must be the production URL, not a preview URL.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={appBaseUrl} onChange={(e) => setAppBaseUrl(e.target.value)} placeholder="https://your-app.base44.app" className="font-mono text-xs" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bitrix24 Marketplace App Credentials</CardTitle>
            <CardDescription>The Client ID &amp; Secret of your Bitrix24 marketplace app. Used to refresh tokens for all connected portals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>App Client ID</Label>
              <Input value={b24ClientId} onChange={(e) => setB24ClientId(e.target.value)} placeholder="Bitrix24 app client ID" />
            </div>
            <div className="space-y-2">
              <Label>App Client Secret</Label>
              <Input type="password" value={b24ClientSecret} onChange={(e) => setB24ClientSecret(e.target.value)} placeholder="Bitrix24 app client secret" />
            </div>
            <Button
              onClick={() => saveConfig.mutate({ app_base_url: appBaseUrl, bitrix24_app_client_id: b24ClientId, bitrix24_app_client_secret: b24ClientSecret })}
              disabled={saveConfig.isPending}
              className="gap-2"
            >
              <Save className="h-4 w-4" /> {saveConfig.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bitrix24 Marketplace App URLs</CardTitle>
            <CardDescription>Paste these into your Bitrix24 marketplace app configuration. Required permissions: <code className="font-mono">im</code>, <code className="font-mono">imconnector</code>, <code className="font-mono">imopenlines</code>.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Installer / Handler URL (app handler)</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs font-mono break-all select-all">{installerUrl}</div>
                <Button variant="outline" size="icon" className="flex-shrink-0 h-8 w-8" onClick={() => copyUrl(installerUrl, setCopiedInstaller)}>
                  {copiedInstaller ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Event Handler URL (<code className="font-mono">ONIMCONNECTORMESSAGEADD</code>)</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs font-mono break-all select-all">{handlerUrl}</div>
                <Button variant="outline" size="icon" className="flex-shrink-0 h-8 w-8" onClick={() => copyUrl(handlerUrl, setCopiedHandler)}>
                  {copiedHandler ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">When a portal installs the app, its account and a default Open Channel are created automatically. Then map the channel to a SendPulse account under <strong>Open Channels</strong>.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Re-register Bitrix24 Placements</CardTitle>
            <CardDescription>Re-registers the LEFT_MENU app link, Contact Center connector, and CRM tabs across all connected portals using the current App Production URL. Run this if the app stopped appearing or is showing an auth error inside Bitrix24.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => rebindPlacements.mutate()} disabled={rebindPlacements.isPending} className="gap-2">
              {rebindPlacements.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {rebindPlacements.isPending ? "Re-registering..." : "Re-register Placements"}
            </Button>
            {rebindPlacements.data?.data?.results && (
              <div className="mt-3 space-y-1">
                {rebindPlacements.data.data.results.map((r, i) => (
                  <div key={i} className="text-xs flex items-center gap-2">
                    {r.ok ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <span className="text-destructive">✕</span>}
                    <span className="font-medium">{r.account}</span>
                    <span className="text-muted-foreground">left_menu: {r.left_menu} · contact_center: {r.contact_center}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Webhook className="h-4 w-4" /> Receive Replies from Bitrix24</CardTitle>
            <CardDescription>Connects the real-time outgoing webhook so agent replies in Bitrix24 are pushed here instantly instead of relying on slow polling. Run this once per portal (no reinstall needed) — and again if you change the App Production URL.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => bindWebhook.mutate()} disabled={bindWebhook.isPending} className="gap-2">
              {bindWebhook.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Webhook className="h-4 w-4" />}
              {bindWebhook.isPending ? "Connecting..." : "Connect Reply Webhook"}
            </Button>
            {bindWebhook.data?.data?.results && (
              <div className="mt-3 space-y-1">
                {bindWebhook.data.data.results.map((r, i) => (
                  <div key={i} className="text-xs flex items-center gap-2">
                    {r.ok ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <span className="h-3.5 w-3.5 text-destructive">✕</span>}
                    <span className="font-medium">{r.account}</span>
                    <span className="text-muted-foreground">{r.ok ? "connected" : (r.reason || r.error || "failed")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}