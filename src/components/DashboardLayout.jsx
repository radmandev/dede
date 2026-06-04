import { Link, useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { MessageSquare, Settings, Send, Server, Cable, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function DashboardLayout() {
  const location = useLocation();

  return (
    <div className="h-screen flex font-inter">
      {/* Slim sidebar */}
      <div className="w-16 bg-sidebar flex flex-col items-center py-4 border-r border-sidebar-border">
        <div className="mb-8">
          <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center">
            <MessageSquare className="h-5 w-5 text-primary-foreground" />
          </div>
        </div>

        <TooltipProvider delayDuration={100}>
          <nav className="flex flex-col gap-2 flex-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-10 w-10 rounded-xl ${location.pathname === "/" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
                  >
                    <MessageSquare className="h-5 w-5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Inbox</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/sendpulse-accounts">
                  <Button variant="ghost" size="icon" className={`h-10 w-10 rounded-xl ${location.pathname === "/sendpulse-accounts" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}>
                    <Send className="h-5 w-5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">SendPulse Accounts</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/bitrix24-accounts">
                  <Button variant="ghost" size="icon" className={`h-10 w-10 rounded-xl ${location.pathname === "/bitrix24-accounts" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}>
                    <Server className="h-5 w-5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Bitrix24 Accounts</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/channels">
                  <Button variant="ghost" size="icon" className={`h-10 w-10 rounded-xl ${location.pathname === "/channels" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}>
                    <Cable className="h-5 w-5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Open Channels</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/settings">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-10 w-10 rounded-xl ${location.pathname === "/settings" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
                  >
                    <Settings className="h-5 w-5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/admin-queue">
                  <Button variant="ghost" size="icon" className={`h-10 w-10 rounded-xl ${location.pathname === "/admin-queue" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}>
                    <ShieldCheck className="h-5 w-5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Admin Queue</TooltipContent>
            </Tooltip>
          </nav>

          {/* Bottom actions */}
          <div className="mt-auto flex flex-col gap-2 items-center">

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-xl text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  onClick={() => base44.auth.logout()}
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