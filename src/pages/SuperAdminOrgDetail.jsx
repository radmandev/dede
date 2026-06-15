import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { ArrowLeft, Users, Send, Server, Cable, RefreshCw, Trash2, CheckCircle2, XCircle, Clock, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function SuperAdminOrgDetail() {
  const { orgId } = useParams();
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [sendpulseAccounts, setSendpulseAccounts] = useState([]);
  const [bitrix24Accounts, setBitrix24Accounts] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [orgRes, membersRes, spRes, bxRes, chRes] = await Promise.all([
        supabase.from('organizations').select('id, name, created_at').eq('id', orgId).single(),
        supabase.from('profiles').select('id, display_name, org_role, created_at').eq('organization_id', orgId).order('created_at'),
        supabase.from('sendpulse_accounts').select('id, name, status, created_at, updated_at').eq('organization_id', orgId).order('created_at'),
        supabase.from('bitrix24_accounts').select('id, name, domain, status, created_at, updated_at').eq('organization_id', orgId).order('created_at'),
        supabase.from('bitrix24_open_channels').select('id, name, status, channel, created_at, updated_at').eq('organization_id', orgId).order('created_at'),
      ]);

      if (orgRes.error) throw orgRes.error;
      setOrg(orgRes.data);
      setMembers(membersRes.data || []);
      setSendpulseAccounts(spRes.data || []);
      setBitrix24Accounts(bxRes.data || []);
      setChannels(chRes.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchData(); }, [orgId]);

  async function removeMember(profileId) {
    await supabase.from('organization_members').delete().eq('profile_id', profileId).eq('organization_id', orgId);
    await supabase.from('profiles').update({ organization_id: null, org_role: 'member' }).eq('id', profileId);
    fetchData();
  }

  async function deleteSendpulseAccount(id) {
    await supabase.from('sendpulse_accounts').delete().eq('id', id);
    fetchData();
  }

  async function deleteBitrix24Account(id) {
    await supabase.from('bitrix24_accounts').delete().eq('id', id);
    fetchData();
  }

  async function deleteChannel(id) {
    await supabase.from('bitrix24_open_channels').delete().eq('id', id);
    fetchData();
  }

  if (loading && !org) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link to="/super-admin" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex-1">{org?.name ?? 'Organization'}</h1>
          {org && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                startImpersonation({ id: org.id, name: org.name });
                navigate('/');
              }}
            >
              <LogIn className="h-4 w-4" />
              View as this org
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-6 ml-7">
          Created {org ? new Date(org.created_at).toLocaleDateString() : ''}
        </p>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm mb-6">
            {error}
          </div>
        )}

        <div className="flex justify-end mb-4">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <Tabs defaultValue="members">
          <TabsList className="mb-6">
            <TabsTrigger value="members" className="gap-2">
              <Users className="h-4 w-4" /> Members <CountBadge count={members.length} />
            </TabsTrigger>
            <TabsTrigger value="sendpulse" className="gap-2">
              <Send className="h-4 w-4" /> SendPulse <CountBadge count={sendpulseAccounts.length} />
            </TabsTrigger>
            <TabsTrigger value="bitrix24" className="gap-2">
              <Server className="h-4 w-4" /> Bitrix24 <CountBadge count={bitrix24Accounts.length} />
            </TabsTrigger>
            <TabsTrigger value="channels" className="gap-2">
              <Cable className="h-4 w-4" /> Open Channels <CountBadge count={channels.length} />
            </TabsTrigger>
          </TabsList>

          {/* Members */}
          <TabsContent value="members">
            <SectionTable
              empty={members.length === 0}
              emptyText="No members in this organization."
              headers={['Name', 'Role', 'Joined', '']}
            >
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="py-3 px-4 text-sm font-medium">{m.display_name || '—'}</td>
                  <td className="py-3 px-4">
                    <RoleBadge role={m.org_role} />
                  </td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <DeleteButton
                      title="Remove member"
                      description="This will remove the member from this organization. Their account will remain but they'll lose access to org resources."
                      onConfirm={() => removeMember(m.id)}
                    />
                  </td>
                </tr>
              ))}
            </SectionTable>
          </TabsContent>

          {/* SendPulse accounts */}
          <TabsContent value="sendpulse">
            <SectionTable
              empty={sendpulseAccounts.length === 0}
              emptyText="No SendPulse accounts configured."
              headers={['Name', 'Status', 'Last updated', '']}
            >
              {sendpulseAccounts.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="py-3 px-4 text-sm font-medium">{a.name || '—'}</td>
                  <td className="py-3 px-4"><StatusBadge status={a.status} /></td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">
                    {new Date(a.updated_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <DeleteButton
                      title="Delete SendPulse account"
                      description="This will permanently delete this SendPulse account and all associated bots. This action cannot be undone."
                      onConfirm={() => deleteSendpulseAccount(a.id)}
                    />
                  </td>
                </tr>
              ))}
            </SectionTable>
          </TabsContent>

          {/* Bitrix24 accounts */}
          <TabsContent value="bitrix24">
            <SectionTable
              empty={bitrix24Accounts.length === 0}
              emptyText="No Bitrix24 accounts configured."
              headers={['Name', 'Domain', 'Status', 'Last updated', '']}
            >
              {bitrix24Accounts.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="py-3 px-4 text-sm font-medium">{a.name || '—'}</td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">{a.domain || '—'}</td>
                  <td className="py-3 px-4"><StatusBadge status={a.status} /></td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">
                    {new Date(a.updated_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <DeleteButton
                      title="Delete Bitrix24 account"
                      description="This will permanently delete this Bitrix24 account and all linked open channels. This action cannot be undone."
                      onConfirm={() => deleteBitrix24Account(a.id)}
                    />
                  </td>
                </tr>
              ))}
            </SectionTable>
          </TabsContent>

          {/* Open Channels */}
          <TabsContent value="channels">
            <SectionTable
              empty={channels.length === 0}
              emptyText="No open channels configured."
              headers={['Name', 'Channel', 'Status', 'Created', '']}
            >
              {channels.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="py-3 px-4 text-sm font-medium">{c.name || '—'}</td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">{c.channel || '—'}</td>
                  <td className="py-3 px-4"><StatusBadge status={c.status} /></td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <DeleteButton
                      title="Delete open channel"
                      description="This will permanently delete this open channel. This action cannot be undone."
                      onConfirm={() => deleteChannel(c.id)}
                    />
                  </td>
                </tr>
              ))}
            </SectionTable>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SectionTable({ headers, children, empty, emptyText }) {
  if (empty) {
    return <div className="text-center py-16 text-muted-foreground text-sm">{emptyText}</div>;
  }
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={`py-2.5 px-4 text-xs font-medium text-muted-foreground ${i === headers.length - 1 ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function CountBadge({ count }) {
  return (
    <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {count}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    active: { label: 'Active', icon: CheckCircle2, className: 'text-green-600 bg-green-50 border-green-200' },
    configured: { label: 'Configured', icon: CheckCircle2, className: 'text-green-600 bg-green-50 border-green-200' },
    not_configured: { label: 'Not configured', icon: XCircle, className: 'text-muted-foreground bg-muted border-border' },
    inactive: { label: 'Inactive', icon: XCircle, className: 'text-muted-foreground bg-muted border-border' },
    pending: { label: 'Pending', icon: Clock, className: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  };
  const config = map[status] || { label: status, icon: Clock, className: 'text-muted-foreground bg-muted border-border' };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${config.className}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function RoleBadge({ role }) {
  return role === 'admin' ? (
    <Badge variant="secondary" className="text-xs">Admin</Badge>
  ) : (
    <Badge variant="outline" className="text-xs">Member</Badge>
  );
}

function DeleteButton({ title, description, onConfirm }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
