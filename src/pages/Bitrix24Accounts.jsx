import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Zap, ZapOff, Server, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const APP_INSTALL_PATH = "marketplace/detail/rawaj_tech.pulseinbox/?ver=1&install=Y";

export default function Bitrix24Accounts() {
  const queryClient = useQueryClient();
  const [portalUrl, setPortalUrl] = useState("");

  const goInstall = () => {
    let domain = portalUrl.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain) { toast.error("Enter your Bitrix24 portal URL"); return; }
    window.open(`https://${domain}/${APP_INSTALL_PATH}`, "_blank");
  };

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["bitrix24Accounts"],
    queryFn: () => base44.entities.Bitrix24Account.list("-created_date"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Bitrix24Account.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bitrix24Accounts"] });
      toast.success("Account removed");
    },
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Server className="h-5 w-5" /> Bitrix24 Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Portals appear here automatically when the app is installed on a Bitrix24 account.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Connect a Bitrix24 portal</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter your Bitrix24 portal URL, then install the app. After installing, choose the Open Channel directly from the connector card inside Bitrix24.</p>
            <div className="space-y-2">
              <Label>Bitrix24 Portal URL</Label>
              <div className="flex items-center gap-2">
                <Input value={portalUrl} onChange={(e) => setPortalUrl(e.target.value)} placeholder="yourcompany.bitrix24.com" onKeyDown={(e) => e.key === "Enter" && goInstall()} />
                <Button onClick={goInstall} className="gap-2 flex-shrink-0"><ExternalLink className="h-4 w-4" /> Install</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>
        ) : accounts.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            No Bitrix24 portals connected yet. Install the app on a Bitrix24 portal to add one.
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => (
              <Card key={acc.id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{acc.name}</p>
                      <Badge variant={acc.status === "connected" ? "default" : acc.status === "error" ? "destructive" : "secondary"} className="gap-1">
                        {acc.status === "connected" ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
                        {acc.status === "connected" ? "Connected" : acc.status === "error" ? "Error" : "Not configured"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-1 truncate">{acc.domain || "no endpoint"}</p>
                    {acc.member_id && <p className="text-xs text-muted-foreground mt-0.5">member: {acc.member_id}</p>}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(acc.id)} className="text-destructive flex-shrink-0">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}