import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Building2, Users, Send, Server, Cable, ChevronRight, RefreshCw, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function SuperAdminDashboard() {
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const { data: orgsData, error: orgsErr } = await supabase
        .from('organizations')
        .select('id, name, created_at')
        .order('created_at', { ascending: false });
      if (orgsErr) throw orgsErr;

      const orgIds = (orgsData || []).map((o) => o.id);

      const [membersRes, spRes, bxRes, chRes] = await Promise.all([
        supabase.from('profiles').select('id, organization_id').in('organization_id', orgIds),
        supabase.from('sendpulse_accounts').select('id, organization_id, status').in('organization_id', orgIds),
        supabase.from('bitrix24_accounts').select('id, organization_id, status').in('organization_id', orgIds),
        supabase.from('bitrix24_open_channels').select('id, organization_id, status').in('organization_id', orgIds),
      ]);

      const statsMap = {};
      orgIds.forEach((id) => {
        statsMap[id] = { members: 0, sendpulse: 0, bitrix24: 0, channels: 0 };
      });

      (membersRes.data || []).forEach((r) => { if (statsMap[r.organization_id]) statsMap[r.organization_id].members++; });
      (spRes.data || []).forEach((r) => { if (statsMap[r.organization_id]) statsMap[r.organization_id].sendpulse++; });
      (bxRes.data || []).forEach((r) => { if (statsMap[r.organization_id]) statsMap[r.organization_id].bitrix24++; });
      (chRes.data || []).forEach((r) => { if (statsMap[r.organization_id]) statsMap[r.organization_id].channels++; });

      setOrgs(orgsData || []);
      setStats(statsMap);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Organizations</h1>
            <p className="text-sm text-muted-foreground mt-1">All subscribed organizations and their connections</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm mb-6">
            {error}
          </div>
        )}

        {loading && !orgs.length ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
          </div>
        ) : orgs.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">No organizations found.</div>
        ) : (
          <div className="space-y-3">
            {orgs.map((org) => {
              const s = stats[org.id] || {};
              return (
                <div
                  key={org.id}
                  className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 group"
                >
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-foreground truncate">{org.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Created {new Date(org.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <StatBadge icon={Users} value={s.members} label="members" />
                    <StatBadge icon={Send} value={s.sendpulse} label="SendPulse" />
                    <StatBadge icon={Server} value={s.bitrix24} label="Bitrix24" />
                    <StatBadge icon={Cable} value={s.channels} label="channels" />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => {
                        startImpersonation({ id: org.id, name: org.name });
                        navigate('/');
                      }}
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      View as
                    </Button>
                    <Link to={`/super-admin/orgs/${org.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBadge({ icon: Icon, value, label }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium text-foreground">{value ?? 0}</span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
