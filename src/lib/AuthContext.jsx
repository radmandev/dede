import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { base44, supabase, clearCache, setImpersonationOrgId, clearImpersonationOrgId } from '@/api/base44Client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [realOrg, setRealOrg] = useState(null);
  const [realMembership, setRealMembership] = useState(null);
  const [impersonatedOrg, setImpersonatedOrg] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const isAuthenticatedRef = useRef(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        isAuthenticatedRef.current = false;
        setUser(null);
        setProfile(null);
        setRealOrg(null);
        setRealMembership(null);
        setImpersonatedOrg(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        clearCache();
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        checkUserAuth();
      }
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
        setProfile(null);
        setRealOrg(null);
        setRealMembership(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

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
        const { data: inserted, error: iErr } = await supabase
          .from('profiles')
          .insert([{ auth_uid: authUser.id, role: 'user', display_name: authUser.email }])
          .select('*').limit(1).single();
        if (iErr) console.error('profile insert error', iErr);
        profile = inserted;
      }
      setProfile(profile);

      if (profile?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('id, name')
          .eq('id', profile.organization_id)
          .single();

        setRealOrg(org ?? { id: profile.organization_id, name: '' });
        setRealMembership({
          organization_id: profile.organization_id,
          role: profile.org_role || 'member',
        });
      } else {
        setRealOrg(null);
        setRealMembership(null);
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

  const startImpersonation = (org) => {
    setImpersonationOrgId(org.id);
    setImpersonatedOrg(org);
  };

  const stopImpersonation = () => {
    clearImpersonationOrgId();
    setImpersonatedOrg(null);
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setProfile(null);
    setRealOrg(null);
    setRealMembership(null);
    setImpersonatedOrg(null);
    clearCache();
    base44.auth.logout(shouldRedirect ? window.location.href : undefined);
  };

  const navigateToLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  const currentOrg = impersonatedOrg ?? realOrg;
  const currentMembership = impersonatedOrg
    ? { organization_id: impersonatedOrg.id, role: 'admin' }
    : realMembership;

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      isSuperAdmin: profile?.role === 'admin',
      impersonatedOrg,
      startImpersonation,
      stopImpersonation,
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
