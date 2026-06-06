import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Building2, Loader2, CheckCircle2, XCircle, LogIn, UserPlus } from "lucide-react";

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoadingAuth, checkUserAuth } = useAuth();

  const [orgInfo, setOrgInfo] = useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [status, setStatus] = useState("loading"); // loading | ready | accepting | success | error
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    fetchInviteInfo();
  }, [token]);

  useEffect(() => {
    // Auto-accept if user is already authenticated and invitation info loaded
    if (isAuthenticated && status === "ready") {
      handleAccept();
    }
  }, [isAuthenticated, status]);

  const fetchInviteInfo = async () => {
    try {
      const res = await supabase.functions.invoke("getInvitationInfo", {
        body: { token },
      });
      const data = res.data;
      if (data?.error) throw new Error(data.error);
      setOrgInfo(data?.organization);
      setInviteEmail(data?.email || "");
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err.message || "Invalid or expired invitation link.");
      setStatus("error");
    }
  };

  const handleAccept = async () => {
    if (status === "accepting" || status === "success") return;
    setStatus("accepting");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const res = await supabase.functions.invoke("acceptInvitation", {
        body: { token },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      const data = res.data;
      if (data?.error) throw new Error(data.error);
      setStatus("success");
      await checkUserAuth();
      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      setErrorMsg(err.message || "Failed to accept invitation.");
      setStatus("error");
    }
  };

  if (isLoadingAuth || status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
          {status === "error" && (
            <>
              <div className="inline-flex h-14 w-14 rounded-2xl bg-destructive/10 items-center justify-center mb-4">
                <XCircle className="h-7 w-7 text-destructive" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 mb-2">Invitation invalid</h1>
              <p className="text-sm text-slate-500 mb-6">{errorMsg}</p>
              <Button asChild variant="outline">
                <Link to="/login">Go to login</Link>
              </Button>
            </>
          )}

          {status === "success" && (
            <>
              <div className="inline-flex h-14 w-14 rounded-2xl bg-emerald-50 items-center justify-center mb-4">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 mb-2">You're in!</h1>
              <p className="text-sm text-slate-500">Redirecting to dashboard…</p>
            </>
          )}

          {(status === "ready" || status === "accepting") && orgInfo && (
            <>
              <div className="inline-flex h-14 w-14 rounded-2xl bg-primary/10 items-center justify-center mb-4">
                <Building2 className="h-7 w-7 text-primary" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 mb-1">You've been invited</h1>
              <p className="text-sm text-slate-500 mb-1">to join</p>
              <p className="text-lg font-semibold text-slate-800 mb-6">{orgInfo.name}</p>

              {!isAuthenticated ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-500 mb-4">
                    {inviteEmail
                      ? `Sign in or create an account with ${inviteEmail} to accept this invitation.`
                      : "Sign in or create an account to accept this invitation."}
                  </p>
                  <Button asChild className="w-full h-11 gap-2">
                    <Link to={`/login?next=/accept-invite/${token}`}>
                      <LogIn className="h-4 w-4" /> Sign in to accept
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full h-11 gap-2">
                    <Link to={`/register?next=/accept-invite/${token}`}>
                      <UserPlus className="h-4 w-4" /> Create account
                    </Link>
                  </Button>
                </div>
              ) : (
                <Button
                  className="w-full h-11 gap-2"
                  onClick={handleAccept}
                  disabled={status === "accepting"}
                >
                  {status === "accepting" ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Joining…</>
                  ) : (
                    `Join ${orgInfo.name}`
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
