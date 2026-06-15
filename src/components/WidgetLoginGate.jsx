import { useState, useEffect } from "react";
import { supabase, base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Loader2, ShieldAlert } from "lucide-react";

function parseErrorMessage(err) {
  if (!err) return "Access denied";
  // Supabase platform errors arrive as JSON strings — extract human-readable part
  try {
    const parsed = JSON.parse(err);
    return parsed.message || parsed.error || err;
  } catch {}
  return err;
}

function loadBx24Script() {
  return new Promise(resolve => {
    if (window.BX24) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://api.bitrix24.com/api/v1/";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/**
 * Auth gate for Bitrix24 placement widgets (CrmChat, ImTemplatePanel).
 *
 * Flow:
 *  1. Check for an existing Supabase session (covers returning users with valid cookie).
 *  2. If no session and window.BX24 is available → auto-authenticate via the
 *     bitrix24-widget-auth edge function (user never sees a login form).
 *  3. If no BX24 context (VS Code browser, direct URL) → show email/password
 *     form as a fallback for admin users.
 *  4. If B24 auth is denied (user not in permitted list) → show a "contact admin" message.
 */
export default function WidgetLoginGate({ children }) {
  // "checking" | "b24-auth" | "ok" | "no-access" | "login" | "login-error"
  const [status, setStatus] = useState("checking");
  const [accessError, setAccessError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // 1. Check for an existing valid session first (fast path — reads from storage)
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: {} }));
      if (session) {
        if (!cancelled) setStatus("ok");
        return;
      }

      // 2. Try Bitrix24 auto-auth if the BX24 JS API is available
      const hasBx24Script = await loadBx24Script();
      if (hasBx24Script && window.BX24) {
        if (!cancelled) setStatus("b24-auth");
        window.BX24.init(async () => {
          if (cancelled) return;
          try {
            const auth = window.BX24.getAuth?.();
            if (!auth?.access_token || !auth?.domain) throw new Error("No B24 auth data");

            const { data, error } = await supabase.functions.invoke("bitrix24-widget-auth", {
              body: { b24_auth_token: auth.access_token, b24_domain: auth.domain },
            });

            if (error || !data?.session) {
              const raw = data?.error || error?.message || "Access denied";
              if (!cancelled) {
                setAccessError(parseErrorMessage(raw));
                setStatus("no-access");
              }
              return;
            }

            // Set the session — onAuthStateChange will fire and flip status to "ok"
            await supabase.auth.setSession(data.session);
          } catch (err) {
            if (!cancelled) {
              setAccessError(parseErrorMessage(err.message) || "Authentication failed");
              setStatus("no-access");
            }
          }
        });
        return;
      }

      // 3. No BX24 context → show email/password fallback (for admin users)
      if (!cancelled) setStatus("login");
    }

    init();

    // Keep the gate up-to-date if the session changes while the widget is open
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) {
        setStatus("ok");
      } else if (status !== "b24-auth") {
        // Only revert to login if we're not mid-B24-auth flow
        setStatus("login");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setSubmitting(true);
    try {
      await base44.auth.loginViaEmailPassword(email, password);
      // onAuthStateChange above will flip status to "ok"
    } catch (err) {
      setLoginError(err.message || "Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Spinner states ────────────────────────────────────────────────────────────
  if (status === "checking" || status === "b24-auth") {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          {status === "b24-auth" && (
            <p className="text-xs text-muted-foreground">Signing you in…</p>
          )}
        </div>
      </div>
    );
  }

  // ── No access (B24 user not permitted) ───────────────────────────────────────
  if (status === "no-access") {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center p-6 bg-background font-inter text-center">
        <div className="h-12 w-12 bg-destructive/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Access Required</h2>
        <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
          {accessError || "You don't have permission to use this widget."}
        </p>
        <p className="text-xs text-muted-foreground mt-3">
          Contact your administrator to get access.
        </p>
      </div>
    );
  }

  // ── Email/password fallback (admin / direct browser) ─────────────────────────
  if (status === "login") {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center p-6 bg-background font-inter">
        <div className="w-full max-w-[280px] space-y-4">
          <div className="text-center mb-2">
            <div className="h-11 w-11 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Sign in to continue</h2>
            <p className="text-xs text-muted-foreground mt-1">Admin access</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-2.5">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="h-9 text-sm"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="h-9 text-sm"
            />
            {loginError && (
              <p className="text-xs text-destructive">{loginError}</p>
            )}
            <Button type="submit" disabled={submitting} className="w-full h-9 text-sm">
              {submitting
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : "Sign in"
              }
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return children;
}
