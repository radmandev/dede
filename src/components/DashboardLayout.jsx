import { Link, useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { MessageSquare, Settings, Send, Server, Cable, LogOut, ShieldCheck, Users, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const NAV_ITEMS = [
  { to: "/", icon: MessageSquare, label: "Inbox", exact: true },
  { to: "/sendpulse-accounts", icon: Send, label: "SendPulse Accounts" },
  { to: "/bitrix24-accounts", icon: Server, label: "Bitrix24 Accounts" },
  { to: "/channels", icon: Cable, label: "Open Channels" },
  { to: "/team", icon: Users, label: "Team" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/admin-queue", icon: ShieldCheck, label: "Admin Queue" },
];

export default function DashboardLayout() {
  const location = useLocation();
  const { logout, currentOrg, user } = useAuth();

  const isActive = (item) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);

  // Org initials for the logo
  const orgInitials = currentOrg?.name
    ? currentOrg.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <div className="h-screen flex font-inter">
      {/* Slim sidebar */}
      <div className="w-16 bg-sidebar flex flex-col items-center py-4 border-r border-sidebar-border">
        <TooltipProvider delayDuration={100}>
        {/* Org logo / initials */}
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

          {/* Bottom: user avatar + logout */}
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

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
