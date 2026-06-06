import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { base44, supabase, clearCache } from '@/api/base44Client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [currentOrg, setCurrentOrg] = useState(null);
  const [currentMembership, setCurrentMembership] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const isAuthenticatedRef = useRef(false);

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION immediately on mount.
    // SIGNED_IN can fire again on tab focus/token refresh — skip it if already authed
    // to avoid showing the loading spinner unnecessarily.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        isAuthenticatedRef.current = false;
        setUser(null);
        setCurrentOrg(null);
        setCurrentMembership(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        clearCache();
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        // checkUserAuth is safe to call anytime — it won't show the spinner if already authed
        checkUserAuth();
      }
      // TOKEN_REFRESHED / USER_UPDATED: no action needed
    });
    return () => listener?.subscription?.unsubscribe?.();
  }, []);

  const checkUserAuth = async () => {
    const alreadyAuthed = isAuthenticatedRef.current;
    try {
      if (!alreadyAuthed) setIsLoadingAuth(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const authUser = sessionData?.session?.user || null;
      if (!authUser) {
        setUser(null);
        setCurrentOrg(null);
        setCurrentMembership(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

      // Fetch profile (plain select — no relational join to avoid schema-cache issues)
      let profile = null;
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('auth_uid', authUser.id)
        .limit(1);

      if (pErr) console.error('profile lookup error', pErr);

      if (profiles && profiles.length > 0) {
        profile = profiles[0];
      } else {
        // New user — create their profile
        const { data: inserted, error: iErr } = await supabase
          .from('profiles')
          .insert([{ auth_uid: authUser.id, role: 'user', display_name: authUser.email }])
          .select('*').limit(1).single();
        if (iErr) console.error('profile insert error', iErr);
        profile = inserted;
      }

      // Load org from the denormalized fields on profile
      if (profile?.organization_id) {
        // Fetch org name separately — avoids relational join RLS issues
        const { data: org } = await supabase
          .from('organizations')
          .select('id, name')
          .eq('id', profile.organization_id)
          .single();

        setCurrentOrg(org ?? { id: profile.organization_id, name: '' });
        setCurrentMembership({
          organization_id: profile.organization_id,
          role: profile.org_role || 'member',
        });
      } else {
        setCurrentOrg(null);
        setCurrentMembership(null);
      }

      setUser(authUser);
      isAuthenticatedRef.current = true;
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      setAuthChecked(true);
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setCurrentOrg(null);
    setCurrentMembership(null);
    clearCache();
    base44.auth.logout(shouldRedirect ? window.location.href : undefined);
  };

  const navigateToLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider value={{
      user,
      currentOrg,
      currentMembership,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      appPublicSettings: null,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
