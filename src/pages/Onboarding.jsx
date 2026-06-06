import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { supabase, clearCache } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, Send, Loader2, ChevronRight } from "lucide-react";

export default function Onboarding() {
  const navigate = useNavigate();
  const { checkUserAuth, user, currentOrg } = useAuth();
  const [step, setStep] = useState(1);

  // Navigate away after React has re-rendered with the new org in context
  useEffect(() => {
    if (currentOrg) navigate("/", { replace: true });
  }, [currentOrg]);
  const [companyName, setCompanyName] = useState("");
  const [spClientId, setSpClientId] = useState("");
  const [spClientSecret, setSpClientSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!companyName.trim()) { setError("Company name is required"); return; }
    setError("");
    setLoading(true);
    try {
      // Get current profile
      const { data: profiles } = await supabase
        .from("profiles").select("id").eq("auth_uid", user.id).limit(1);
      const profile = profiles?.[0];
      if (!profile?.id) throw new Error("Profile not found. Please refresh and try again.");

      // Create organization
      const { data: org, error: orgErr } = await supabase
        .from("organizations")
        .insert([{ name: companyName.trim(), created_by: profile.id }])
        .select()
        .single();
      if (orgErr) throw orgErr;

      // Add current user as admin member
      const { error: memberErr } = await supabase
        .from("organization_members")
        .insert([{ organization_id: org.id, profile_id: profile.id, role: "admin" }]);
      if (memberErr) throw memberErr;

      // Denormalize org onto profile so RLS helpers can read it without recursion
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ organization_id: org.id, org_role: "admin" })
        .eq("id", profile.id);
      if (profileErr) throw new Error(`Failed to update profile: ${profileErr.message}`);

      // Create SendPulse account if credentials provided
      if (spClientId.trim() && spClientSecret.trim()) {
        await supabase.from("sendpulse_accounts").insert([{
          owner_id: profile.id,
          organization_id: org.id,
          name: `${companyName.trim()} SendPulse`,
          client_id: spClientId.trim(),
          client_secret: spClientSecret.trim(),
          status: "not_configured",
        }]);
      }

      // Update auth context — the useEffect above will navigate once currentOrg is set
      clearCache();
      await checkUserAuth();
    } catch (err) {
      setError(err.message || "Failed to create workspace. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 rounded-2xl bg-primary items-center justify-center mb-4">
            <Building2 className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Set up your workspace</h1>
          <p className="text-sm text-slate-500 mt-1">You're one step away from getting started</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Step indicator */}
          <div className="flex border-b border-slate-100">
            <div className={`flex-1 py-3 text-center text-xs font-medium ${step >= 1 ? "text-primary" : "text-slate-400"}`}>
              <span className={`inline-flex h-5 w-5 rounded-full items-center justify-center text-xs mr-1.5 ${step >= 1 ? "bg-primary text-white" : "bg-slate-200 text-slate-500"}`}>1</span>
              Workspace
            </div>
            <div className={`flex-1 py-3 text-center text-xs font-medium ${step >= 2 ? "text-primary" : "text-slate-400"}`}>
              <span className={`inline-flex h-5 w-5 rounded-full items-center justify-center text-xs mr-1.5 ${step >= 2 ? "bg-primary text-white" : "bg-slate-200 text-slate-500"}`}>2</span>
              SendPulse
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="company">Company / workspace name</Label>
                  <Input
                    id="company"
                    autoFocus
                    placeholder="Acme Corp"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="h-11"
                    required
                  />
                  <p className="text-xs text-muted-foreground">This is how your workspace will appear to your team.</p>
                </div>
                <Button
                  type="button"
                  className="w-full h-11 gap-2"
                  onClick={() => {
                    if (!companyName.trim()) { setError("Company name is required"); return; }
                    setError("");
                    setStep(2);
                  }}
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
                  <Send className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-blue-700">
                    Connect your SendPulse account to start sending and receiving WhatsApp messages. You can also skip this and add it later.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sp-id">SendPulse Client ID</Label>
                  <Input
                    id="sp-id"
                    autoFocus
                    placeholder="Your SendPulse client ID"
                    value={spClientId}
                    onChange={(e) => setSpClientId(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sp-secret">SendPulse Client Secret</Label>
                  <Input
                    id="sp-secret"
                    type="password"
                    placeholder="Your SendPulse client secret"
                    value={spClientSecret}
                    onChange={(e) => setSpClientSecret(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button type="submit" className="flex-1 h-11 gap-2" disabled={loading}>
                    {loading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
                    ) : (
                      spClientId && spClientSecret ? "Create workspace" : "Skip & create"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          Logged in as <span className="font-medium">{user?.email}</span>
        </p>
      </div>
    </div>
  );
}
