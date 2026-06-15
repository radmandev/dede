import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44, supabase } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Users, ShieldAlert, Crown, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

function Avatar({ name, photoUrl, size = "md" }) {
  const sizeClass = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  const initials = (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] || "")
    .join("")
    .toUpperCase() || "?";

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0`}
        onError={e => { e.currentTarget.style.display = "none"; }}
      />
    );
  }
  return (
    <div className={`${sizeClass} rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0`}>
      <span className="font-semibold text-primary">{initials}</span>
    </div>
  );
}

function UserRow({ user, isAdmin, onPermissionChange, updating }) {
  const isActive = user.permission === "active";
  const isDisabled = user.permission === "disabled";

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
      <Avatar name={user.name} photoUrl={user.photo_url} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium truncate">{user.name || `User #${user.b24_user_id}`}</span>
          {user.is_b24_admin && (
            <Crown className="h-3 w-3 text-amber-500 flex-shrink-0" title="Bitrix24 admin" />
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {user.email || `B24 ID: ${user.b24_user_id}`}
          {user.department && ` · ${user.department}`}
          {user.title && ` · ${user.title}`}
        </p>
      </div>
      <div className="flex items-center gap-2.5 flex-shrink-0">
        {user.last_seen_at && (
          <span className="text-[11px] text-muted-foreground hidden sm:block">
            {new Date(user.last_seen_at).toLocaleDateString()}
          </span>
        )}
        <Badge
          variant={isActive ? "default" : isDisabled ? "destructive" : "secondary"}
          className="text-[10px] hidden sm:flex"
        >
          {user.permission}
        </Badge>
        {isAdmin ? (
          updating === user.id ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              checked={isActive}
              onCheckedChange={checked =>
                onPermissionChange(user.id, checked ? "active" : "disabled")
              }
              aria-label={`${isActive ? "Disable" : "Enable"} access for ${user.name}`}
            />
          )
        ) : (
          <Switch checked={isActive} disabled aria-label="Access status" />
        )}
      </div>
    </div>
  );
}

export default function Bitrix24Users() {
  const { currentMembership } = useAuth();
  const isAdmin = currentMembership?.role === "admin";
  const queryClient = useQueryClient();

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  // Load B24 accounts for the org
  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ["bitrix24_accounts"],
    queryFn: () => base44.entities.Bitrix24Account.list("-created_at"),
  });

  // Auto-select first account
  const accountId = selectedAccountId || accounts[0]?.id || "";

  // Load users for selected account
  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ["b24_portal_users", accountId],
    queryFn: () =>
      accountId
        ? supabase
            .from("bitrix24_portal_users")
            .select("*")
            .eq("bitrix24_account_id", accountId)
            .order("name")
            .then(({ data, error }) => {
              if (error) throw error;
              return data ?? [];
            })
        : Promise.resolve([]),
    enabled: !!accountId,
  });

  // Sync users from Bitrix24
  const syncMutation = useMutation({
    mutationFn: () =>
      base44.functions.invoke("sync-bitrix24-users", { bitrix24_account_id: accountId }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["b24_portal_users", accountId] });
      toast.success(`Synced ${result.data?.synced ?? 0} users from Bitrix24`);
    },
    onError: (err) => toast.error(err.message || "Sync failed"),
  });

  // Update a single user's permission
  const updatePermission = async (userId, permission) => {
    setUpdatingId(userId);
    try {
      const { error } = await supabase
        .from("bitrix24_portal_users")
        .update({ permission, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["b24_portal_users", accountId] });
      toast.success(permission === "active" ? "Access granted" : "Access revoked");
    } catch (err) {
      toast.error(err.message || "Failed to update permission");
    } finally {
      setUpdatingId(null);
    }
  };

  const activeCount = users.filter(u => u.permission === "active").length;
  const selectedAccount = accounts.find(a => a.id === accountId);

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted-foreground">
        <ShieldAlert className="h-10 w-10 opacity-30 mb-3" />
        <p className="text-sm font-medium text-foreground">Admin access required</p>
        <p className="text-xs mt-1">Only organisation admins can manage Bitrix24 user permissions.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 max-w-4xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Bitrix24 Users</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sync users from your Bitrix24 portal and control who can access the widget without logging in.
        </p>
      </div>

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {accounts.length > 1 && (
          <Select
            value={accountId}
            onValueChange={setSelectedAccountId}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Select Bitrix24 portal…" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name || a.domain}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={!accountId || syncMutation.isPending}
          className="gap-2"
        >
          {syncMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Sync Users from Bitrix24
        </Button>
      </div>

      {/* Info card */}
      {users.length === 0 && !loadingUsers ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-10 w-10 text-muted-foreground opacity-25 mb-3" />
            <p className="text-sm font-medium text-foreground">No users synced yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              {accountId
                ? "Click "Sync Users" to import all active users from your Bitrix24 portal."
                : "Connect a Bitrix24 account first, then sync users."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {selectedAccount?.name || selectedAccount?.domain || "Portal Users"}
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {loadingUsers
                    ? "Loading…"
                    : `${users.length} users · ${activeCount} with access`}
                </CardDescription>
              </div>
              {!isAdmin && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5" />
                  View only
                </div>
              )}
            </div>
          </CardHeader>

          {loadingUsers ? (
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          ) : (
            <div className="divide-y divide-border">
              {users.map(user => (
                <UserRow
                  key={user.id}
                  user={user}
                  isAdmin={isAdmin}
                  onPermissionChange={updatePermission}
                  updating={updatingId}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {isAdmin && users.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4 text-center">
          Toggle the switch to grant or revoke a user's access to the Bitrix24 widget.
          Users with <strong>Active</strong> permission can open the widget without logging in.
        </p>
      )}
    </div>
  );
}
