import { Link, useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { MessageSquare, Settings, Send, Server, Cable, LogOut, ShieldCheck, Users, Building2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { useIsMobile } from "@/hooks/use-mobile";

const NAV_ITEMS = [
  { to: "/", icon: MessageSquare, label: "Inbox", exact: true },
  { to: "/sendpulse-accounts", icon: Send, label: "SendPulse" },
  { to: "/bitrix24-accounts", icon: Server, label: "Bitrix24" },
  { to: "/bitrix24-users", icon: UserCheck, label: "B24 Users" },
  { to: "/channels", icon: Cable, label: "Channels" },
  { to: "/team", icon: Users, label: "Team" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function DashboardLayout() {
  const location = useLocation();
  const { logout, currentOrg, user, isSuperAdmin } = useAuth();
  const isMobile = useIsMobile();

  const isActive = (item) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);

  const orgInitials = currentOrg?.name
    ? currentOrg.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <div className="h-[100dvh] flex flex-col font-inter">
      <ImpersonationBanner />
      <div className="flex flex-1 overflow-hidden">
        {/* Slim sidebar — desktop only */}
        {!isMobile && (
          <div className="w-16 bg-sidebar flex flex-col items-center py-4 border-r border-sidebar-border">
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="mb-8 h-9 w-9 rounded-xl bg-primary flex items-center justify-center cursor-default select-none">
                    {orgInitials.length > 1 ? (
                      <span className="text-xs font-bold text-primary-foreground">{orgInitials}</span>
                    ) : (
                      <Building2 className="h-5 w-5 text-primary-foreground" />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">{currentOrg?.name || "Workspace"}</TooltipContent>
              </Tooltip>

              <nav className="flex flex-col gap-2 flex-1">
                {NAV_ITEMS.map(({ to, icon: Icon, label, exact }) => (
                  <Tooltip key={to}>
                    <TooltipTrigger asChild>
                      <Link to={to}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-10 w-10 rounded-xl ${
                            isActive({ to, exact })
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                        </Button>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">{label}</TooltipContent>
                  </Tooltip>
                ))}
              </nav>

              {isSuperAdmin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link to="/super-admin">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-10 w-10 rounded-xl ${
                          location.pathname.startsWith('/super-admin')
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                        }`}
                      >
                        <ShieldCheck className="h-5 w-5" />
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">Super Admin</TooltipContent>
                </Tooltip>
              )}

              <div className="mt-auto flex flex-col gap-2 items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center cursor-default select-none border border-sidebar-border">
                      <span className="text-xs font-semibold text-muted-foreground uppercase">
                        {(user?.email || "U").charAt(0)}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">{user?.email}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-xl text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                      onClick={() => logout()}
                    >
                      <LogOut className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Sign Out</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden min-w-0">
          <Outlet />
        </div>
      </div>

      {/* Bottom nav — mobile only */}
      {isMobile && (
        <div
          className="bg-sidebar border-t border-sidebar-border flex items-center justify-around"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {NAV_ITEMS.map(({ to, icon: Icon, label, exact }) => {
            const active = isActive({ to, exact });
            return (
              <Link
                key={to}
                to={to}
                className="flex flex-col items-center gap-0.5 py-2 px-1 flex-1 min-w-0"
              >
                <Icon
                  className={`h-5 w-5 flex-shrink-0 ${
                    active ? "text-primary" : "text-sidebar-foreground/50"
                  }`}
                />
                <span
                  className={`text-[10px] font-medium leading-none truncate w-full text-center ${
                    active ? "text-primary" : "text-sidebar-foreground/50"
                  }`}
                >
                  {label}
                </span>
              </Link>
            );
          })}
          {isSuperAdmin && (
            <Link
              to="/super-admin"
              className="flex flex-col items-center gap-0.5 py-2 px-1 flex-1 min-w-0"
            >
              <ShieldCheck
                className={`h-5 w-5 flex-shrink-0 ${
                  location.pathname.startsWith('/super-admin')
                    ? "text-destructive"
                    : "text-destructive/40"
                }`}
              />
              <span
                className={`text-[10px] font-medium leading-none ${
                  location.pathname.startsWith('/super-admin')
                    ? "text-destructive"
                    : "text-destructive/40"
                }`}
              >
                Admin
              </span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
