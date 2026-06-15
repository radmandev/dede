import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ImpersonationBanner() {
  const { impersonatedOrg, stopImpersonation } = useAuth();
  const navigate = useNavigate();

  if (!impersonatedOrg) return null;

  const handleExit = () => {
    stopImpersonation();
    navigate('/super-admin');
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-amber-950 text-sm font-medium shrink-0">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>
          Viewing as <strong>{impersonatedOrg.name}</strong> — changes you make will affect this organization.
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-amber-950 hover:bg-amber-600 hover:text-amber-950"
        onClick={handleExit}
      >
        <X className="h-3.5 w-3.5 mr-1" />
        Exit
      </Button>
    </div>
  );
}
