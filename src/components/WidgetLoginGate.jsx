import { useState, useEffect } from "react";
import { supabase, base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Loader2 } from "lucide-react";

/**
 * Wraps Bitrix24 placement widgets. Checks for an existing Supabase session
 * (using getSession which reads localStorage and auto-refreshes expired tokens).
 * When no session is found it renders an inline login form instead of a dead-end
 * error message, so the user never has to leave the Bitrix24 app to re-authenticate.
 */
export default function WidgetLoginGate({ children }) {
  const [status, setStatus] = useState("checking"); // "checking" | "ok" | "login"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // getSession() reads from localStorage and triggers a silent token refresh
    // if the access token is expired but the refresh token is still valid.
    // This is more reliable than getUser() which always makes a network request.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus(session ? "ok" : "login");
    }).catch(() => {
      setStatus("login");
    });

    // Keep the gate up-to-date if the session changes while the widget is open
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? "ok" : "login");
    });
    return () => subscription.unsubscribe();
  }, []);

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

  if (status === "checking") {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (status === "login") {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-6 bg-background font-inter">
        <div className="w-full max-w-[280px] space-y-4">
          <div className="text-center mb-2">
            <div className="h-11 w-11 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Sign in to continue</h2>
            <p className="text-xs text-muted-foreground mt-1">Your session has expired</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-2.5">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="h-9 text-sm"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
