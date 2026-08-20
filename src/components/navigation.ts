import {
  Building2,
  CalendarClock,
  CreditCard,
  ExternalLink,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  Settings,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";

// Single source of truth for primary navigation. The sidebar (desktop) and the
// drawer (mobile) both render this, so the two can no longer drift apart in
// either the set of destinations they expose or the labels they use.
//
// /clients has no fixture-backed tier, by design: it reads live company
// records in production and renders an explanatory notice in demo mode
// (see DemoClientNotice) rather than a fixture board. /enquiries, /teams
// and /tasks remain deleted — each had no table behind it, or is superseded
// by a screen already reading Postgres (/work-queue, /annual-returns).

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Rendered indented under the preceding item to show it is a sub-destination. */
  nested?: boolean;
};

export type NavGroup = {
  heading: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    heading: "Operations",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/work-queue", label: "Work Queue", icon: ListChecks },
      { to: "/annual-returns", label: "Annual Returns", icon: CalendarClock },
      { to: "/clients", label: "Clients", icon: Building2 },
      { to: "/documents", label: "Documents", icon: FileText },
      { to: "/portal", label: "Portal", icon: ExternalLink },
      { to: "/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    heading: "Messaging",
    items: [
      { to: "/whatsapp", label: "WhatsApp Inbox", icon: MessageCircle, exact: true },
      { to: "/whatsapp/automation", label: "WhatsApp Automation", icon: Zap, nested: true },
    ],
  },
  {
    heading: "Administration",
    items: [
      { to: "/admin", label: "Admin", icon: ShieldCheck },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
