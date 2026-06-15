import { Link, useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Building2, ShieldCheck, LogOut, ArrowLeft, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const NAV_ITEMS = [
  { to: "/super-admin", icon: Building2, label: "Organizations", exact: true },
  { to: "/super-admin/queue", icon: ListOrdered, label: "Delivery Queue" },
];

export default function SuperAdminLayout() {
  const location = useLocation();
  const { logout, user } = useAuth();

  const isActive = (item) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);

  return (
    <div className="h-screen flex font-inter">
      {/* Slim sidebar */}
      <div className="w-16 bg-sidebar flex flex-col items-center py-4 border-r border-sidebar-border">
        <TooltipProvider delayDuration={100}>
          {/* Super admin badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="mb-8 h-9 w-9 rounded-xl bg-destructive flex items-center justify-center cursor-default select-none">
                <ShieldCheck className="h-5 w-5 text-destructive-foreground" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">Super Admin</TooltipContent>
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

          {/* Bottom: back to app, user avatar, logout */}
          <div className="mt-auto flex flex-col gap-2 items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-xl text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Back to App</TooltipContent>
            </Tooltip>

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
