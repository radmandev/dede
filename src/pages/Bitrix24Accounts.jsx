import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Zap, ZapOff, Server, Radio, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

function normalizeDomain(url) {
  return url.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

function OpenChannelsList({ accountId }) {
  const [lines, setLines] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("bitrix24ListLines", { bitrix24_account_id: accountId });
      if (res.data?.error) throw new Error(res.data.error);
      setLines(res.data?.lines || []);
      setFetched(true);
    } catch (e) {
      toast.error("Failed to fetch channels: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!fetched) {
    return (
      <Button size="sm" variant="outline" onClick={fetch} disabled={loading} className="gap-1.5">
        {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
        View Open Channels
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Open Channels</p>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={fetch} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No open channels found in this portal.</p>
      ) : (
        lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
            <div>
              <p className="text-sm font-medium">{line.name}</p>
              <p className="text-xs text-muted-foreground font-mono">Line ID: {line.id}</p>
            </div>
            <Badge variant="secondary" className="text-xs">Open Channel</Badge>
          </div>
        ))
      )}
    </div>
  );
}

export default function Bitrix24Accounts() {
  const queryClient = useQueryClient();
  const [portalUrl, setPortalUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState(null); // { account } | { notFound: true }

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["bitrix24Accounts"],
    queryFn: () => base44.entities.Bitrix24Account.list("-created_at"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Bitrix24Account.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bitrix24Accounts"] });
      toast.success("Account removed");
    },
  });

  const handleConnect = async () => {
    const domain = normalizeDomain(portalUrl);
    if (!domain) { toast.error("Enter your Bitrix24 portal URL"); return; }
    setConnecting(true);
    setResult(null);
    try {
      const match = accounts.find((acc) =>
        normalizeDomain(acc.domain || "").includes(domain) || domain.includes(normalizeDomain(acc.domain || ""))
      );
      if (!match) {
        setResult({ notFound: true, domain });
      } else {
        setResult({ account: match });
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-5 w-5" /> Bitrix24 Accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your Bitrix24 portal URL to view its connected open channels.
          </p>
        </div>

        {/* URL input */}
        <Card>
          <CardHeader><CardTitle className="text-base">Connect a portal</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Bitrix24 Portal URL</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={portalUrl}
                  onChange={(e) => setPortalUrl(e.target.value)}
                  placeholder="yourcompany.bitrix24.com"
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                />
                <Button onClick={handleConnect} disabled={connecting} className="gap-2 flex-shrink-0">
                  {connecting
                    ? <RefreshCw className="h-4 w-4 animate-spin" />
                    : <Zap className="h-4 w-4" />}
                  Connect
                </Button>
              </div>
            </div>

            {/* Result of connect */}
            {result?.notFound && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
                <p className="font-medium text-destructive">No account found for <span className="font-mono">{result.domain}</span></p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Make sure you have activated the app inside Bitrix24 using the same account you're signed in with here.
                </p>
              </div>
            )}

            {result?.account && (
              <div className="rounded-lg border bg-muted/30 px-4 py-4 space-y-1">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-green-500" />
                  <p className="font-semibold">{result.account.name}</p>
                  <Badge variant={result.account.status === "connected" ? "default" : "destructive"}>
                    {result.account.status === "connected" ? "Connected" : result.account.status || "Unknown"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono">{result.account.domain}</p>
                <OpenChannelsList accountId={result.account.id} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* All connected portals */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : accounts.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Connected portals</p>
            {accounts.map((acc) => (
              <Card key={acc.id}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{acc.name}</p>
                        <Badge
                          variant={acc.status === "connected" ? "default" : acc.status === "error" ? "destructive" : "secondary"}
                          className="gap-1"
                        >
                          {acc.status === "connected" ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
                          {acc.status === "connected" ? "Connected" : acc.status === "error" ? "Error" : "Not configured"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1 truncate">{acc.domain || "no endpoint"}</p>
                      {acc.member_id && <p className="text-xs text-muted-foreground">member: {acc.member_id}</p>}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(acc.id)}
                      disabled={deleteMutation.isPending}
                      className="text-destructive flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <OpenChannelsList accountId={acc.id} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!isLoading && accounts.length === 0 && !result && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No Bitrix24 portals connected yet. Enter your portal URL above to get started.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
