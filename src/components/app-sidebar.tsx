import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Inbox,
  Building2,
  CalendarClock,
  FileText,
  ExternalLink,
  CreditCard,
  MessageCircle,
  CheckSquare,
  Users,
  ShieldCheck,
  Settings,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/work-queue", label: "Work Queue", icon: ListChecks },
  { to: "/enquiries", label: "Enquiries", icon: Inbox },
  { to: "/clients", label: "Clients", icon: Building2 },
  { to: "/annual-returns", label: "Annual Returns", icon: CalendarClock },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/portal", label: "Portal", icon: ExternalLink },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/whatsapp", label: "WhatsApp Inbox", icon: MessageCircle, exact: true },
  { to: "/whatsapp/automation", label: "WhatsApp Automation", icon: MessageCircle },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/teams", label: "Teams", icon: Users },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="font-display text-sm font-bold">K</span>
        </div>
        <div className="leading-tight">
          <div className="font-display text-sm font-semibold text-sidebar-foreground">Kossilon</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">CoSec OS</div>
        </div>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {nav.map((item) => {
            const active = item.exact
              ? pathname === item.to
              : pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to as never}
                  activeOptions={item.exact ? { exact: true } : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-md bg-accent/60 p-3">
          <p className="text-xs font-medium text-foreground">Filing quarter: Q3 2026</p>
          <p className="mt-1 text-[11px] text-muted-foreground">128 annual returns in progress</p>
        </div>
      </div>
    </aside>
  );
}
