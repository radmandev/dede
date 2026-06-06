import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';
import DashboardLayout from './components/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import SendPulseAccounts from './pages/SendPulseAccounts';
import Bitrix24Accounts from './pages/Bitrix24Accounts';
import OpenChannels from './pages/OpenChannels';
import AdminQueue from './pages/AdminQueue';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import CrmChat from './pages/CrmChat';
import Onboarding from './pages/Onboarding';
import AcceptInvite from './pages/AcceptInvite';
import Team from './pages/Team';

// Guard: redirect authenticated users without an org to onboarding
function RequireOrg({ children }) {
  const { currentOrg, isLoadingAuth } = useAuth();
  const location = useLocation();
  if (isLoadingAuth) return null;
  if (!currentOrg) return <Navigate to="/onboarding" state={{ from: location }} replace />;
  return children;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authChecked, authError, navigateToLogin } = useAuth();

  // Only block rendering on the very first auth check, not on background re-checks
  if (isLoadingPublicSettings || (isLoadingAuth && !authChecked)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') { navigateToLogin(); return null; }
  }

  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/accept-invite/:token" element={<AcceptInvite />} />

      {/* Authenticated routes */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        {/* Onboarding: for users without an org */}
        <Route path="/onboarding" element={<Onboarding />} />

        {/* CRM Chat (org required) */}
        <Route path="/crm-chat" element={
          <RequireOrg><CrmChat /></RequireOrg>
        } />

        {/* Main dashboard (org required) */}
        <Route element={
          <RequireOrg><DashboardLayout /></RequireOrg>
        }>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/team" element={<Team />} />
          <Route path="/sendpulse-accounts" element={<SendPulseAccounts />} />
          <Route path="/bitrix24-accounts" element={<Bitrix24Accounts />} />
          <Route path="/channels" element={<OpenChannels />} />
          <Route path="/admin-queue" element={<AdminQueue />} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
