import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

export default function RequireSuperAdmin({ children }) {
  const { isAuthenticated, isSuperAdmin, isLoadingAuth, authChecked } = useAuth();

  if (isLoadingAuth && !authChecked) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isSuperAdmin) return <Navigate to="/" replace />;

  return children;
}
