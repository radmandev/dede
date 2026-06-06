import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Users, UserPlus, Copy, Check, Trash2, Crown, Loader2,
  RefreshCw, Server, Mail
} from "lucide-react";
import { toast } from "sonner";

function MemberRow({ member, isAdmin, currentProfileId, onRemove, isRemoving }) {
  const isSelf = member.profiles?.id === currentProfileId || member.profile_id === currentProfileId;
  const canRemove = isAdmin && !isSelf;

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-muted/40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-semibold text-primary uppercase">
            {(member.profiles?.display_name || member.email || "?").charAt(0)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {member.profiles?.display_name || member.email || "Unknown"}
            {isSelf && <span className="text-xs text-muted-foreground ml-1">(you)</span>}
          </p>
          {member.profiles?.display_name && (
            <p className="text-xs text-muted-foreground truncate">{member.profiles.display_name}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
        <Badge variant={member.role === "admin" ? "default" : "secondary"} className="gap-1 text-xs">
          {member.role === "admin" && <Crown className="h-3 w-3" />}
          {member.role}
        </Badge>
        {canRemove && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onRemove(member.id)}
            disabled={isRemoving}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function InvitationRow({ invitation, isAdmin, onRevoke, isRevoking, orgId }) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${window.location.origin}/accept-invite/${invitation.token}`;

  const copyLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Invite link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const daysLeft = Math.max(0, Math.round(
    (new Date(invitation.expires_at) - new Date()) / (1000 * 60 * 60 * 24)
  ));

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-lg bg-amber-50/50 border border-amber-100">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Mail className="h-3.5 w-3.5 text-amber-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{invitation.email}</p>
          <p className="text-xs text-muted-foreground">Pending · expires in {daysLeft}d</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
        <Button size="icon" variant="outline" className="h-7 w-7" onClick={copyLink}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        {isAdmin && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onRevoke(invitation.id)}
            disabled={isRevoking}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Team() {
  const queryClient = useQueryClient();
  const { currentOrg, currentMembership, user } = useAuth();
  const isAdmin = currentMembership?.role === "admin";
  const orgId = currentOrg?.id;

  const [inviteEmail, setInviteEmail] = useState("");
  const [showBitrixUsers, setShowBitrixUsers] = useState(false);
  const [bitrixUsers, setBitrixUsers] = useState([]);
  const [bitrixLoading, setBitrixLoading] = useState(false);

  // Current user's profile id
  const { data: myProfile } = useQuery({
    queryKey: ["myProfile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id").eq("auth_uid", user.id).single();
      return data;
    },
    enabled: !!user,
  });

  // Members list
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["orgMembers", orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from("organization_members")
        .select("id, role, profile_id, profiles(id, display_name, auth_uid)")
        .eq("organization_id", orgId)
        .order("created_at");
      return data || [];
    },
    enabled: !!orgId,
  });

  // Pending invitations
  const { data: invitations = [], isLoading: invitesLoading } = useQuery({
    queryKey: ["orgInvitations", orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from("invitations")
        .select("id, email, token, status, expires_at, created_at")
        .eq("organization_id", orgId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!orgId,
  });

  const inviteMutation = useMutation({
    mutationFn: async (email) => {
      const { data: profile } = await supabase
        .from("profiles").select("id").eq("auth_uid", user.id).single();
      const { data, error } = await supabase
        .from("invitations")
        .insert([{ organization_id: orgId, email: email.trim().toLowerCase(), invited_by: profile?.id }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["orgInvitations", orgId] });
      const inviteUrl = `${window.location.origin}/accept-invite/${data.token}`;
      navigator.clipboard.writeText(inviteUrl).catch(() => {});
      toast.success("Invitation created! Link copied to clipboard.");
      setInviteEmail("");
    },
    onError: (e) => toast.error(e.message || "Failed to create invitation"),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId) =>
      supabase.from("organization_members").delete().eq("id", memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgMembers", orgId] });
      toast.success("Member removed");
    },
    onError: (e) => toast.error(e.message || "Failed to remove member"),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId) =>
      supabase.from("invitations").update({ status: "expired" }).eq("id", inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgInvitations", orgId] });
      toast.success("Invitation revoked");
    },
  });

  const handleInviteSubmit = (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate(inviteEmail);
  };

  const loadBitrixUsers = async () => {
    setBitrixLoading(true);
    setShowBitrixUsers(true);
    try {
      const { data: accounts } = await supabase
        .from("bitrix24_accounts")
        .select("id, name, domain, access_token")
        .eq("organization_id", orgId)
        .eq("status", "connected");

      if (!accounts?.length) {
        setBitrixUsers([]);
        toast.info("No connected Bitrix24 portals found for this workspace.");
        return;
      }

      const allUsers = [];
      for (const acc of accounts) {
        try {
          const res = await fetch(`${acc.domain}user.get?auth=${acc.access_token}&FILTER[ACTIVE]=Y`);
          const json = await res.json();
          const users = Array.isArray(json?.result) ? json.result : [];
          for (const u of users) {
            if (u.EMAIL) {
              allUsers.push({
                id: `${acc.id}_${u.ID}`,
                name: [u.NAME, u.LAST_NAME].filter(Boolean).join(" ") || u.EMAIL,
                email: u.EMAIL,
                portal: acc.name,
              });
            }
          }
        } catch {
          // ignore individual portal errors
        }
      }

      // Filter out already-invited and existing members
      const existingEmails = new Set([
        ...members.map((m) => m.profiles?.display_name),
        ...invitations.map((i) => i.email),
      ]);
      setBitrixUsers(allUsers.filter((u) => !existingEmails.has(u.email)));
    } finally {
      setBitrixLoading(false);
    }
  };

  const inviteBitrixUser = async (email) => {
    inviteMutation.mutate(email);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto py-8 px-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5" /> Team
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage who has access to <span className="font-medium text-foreground">{currentOrg?.name}</span>.
          </p>
        </div>

        {/* Members */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members ({members.length})</CardTitle>
            <CardDescription>People with access to this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {membersLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {members.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    isAdmin={isAdmin}
                    currentProfileId={myProfile?.id}
                    onRemove={(id) => removeMemberMutation.mutate(id)}
                    isRemoving={removeMemberMutation.isPending}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invite by email */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="h-4 w-4" /> Invite by email
              </CardTitle>
              <CardDescription>
                An invite link will be created that you can share. It expires in 7 days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInviteSubmit} className="flex gap-2">
                <Input
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="flex-1 h-10"
                  required
                />
                <Button type="submit" className="gap-2 h-10" disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <><UserPlus className="h-4 w-4" /> Invite</>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending invitations ({invitations.length})</CardTitle>
              <CardDescription>These people have been invited but haven't joined yet.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {invitations.map((inv) => (
                <InvitationRow
                  key={inv.id}
                  invitation={inv}
                  isAdmin={isAdmin}
                  orgId={orgId}
                  onRevoke={(id) => revokeInviteMutation.mutate(id)}
                  isRevoking={revokeInviteMutation.isPending}
                />
              ))}
            </CardContent>
          </Card>
        )}

        {/* Bitrix24 user sync */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4" /> Sync from Bitrix24
              </CardTitle>
              <CardDescription>
                Import users from connected Bitrix24 portals and send them invitations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="gap-2"
                onClick={loadBitrixUsers}
                disabled={bitrixLoading}
              >
                {bitrixLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Loading users…</>
                ) : (
                  <><RefreshCw className="h-4 w-4" /> Load Bitrix24 users</>
                )}
              </Button>

              {showBitrixUsers && !bitrixLoading && (
                <div className="space-y-2 mt-2">
                  {bitrixUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No new users found — all Bitrix24 users are already invited or members.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">{bitrixUsers.length} user(s) found</p>
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {bitrixUsers.map((u) => (
                          <div key={u.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{u.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{u.email} · {u.portal}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-shrink-0 ml-2 h-7 text-xs gap-1"
                              onClick={() => inviteBitrixUser(u.email)}
                              disabled={inviteMutation.isPending}
                            >
                              <UserPlus className="h-3 w-3" /> Invite
                            </Button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
