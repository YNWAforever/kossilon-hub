import {
  Activity,
  Building2,
  CalendarClock,
  CreditCard,
  ExternalLink,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  Repeat2,
  Rocket,
  Settings,
  ShieldCheck,
  Zap,
  type LucideIcon,
  Upload,
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

// Grouped by what a staff member is doing rather than by which subsystem owns
// the screen. It was thirteen destinations across Operations / Messaging /
// Administration, with nothing shaped like "what do I do today" -- the board
// answers which cases exist, which is a different question.
//
// Every previous destination is still here. Manager and admin surfaces keep
// their own group rather than being folded into daily work, and no route was
// removed: a screen someone has bookmarked still resolves.
export const navGroups: NavGroup[] = [
  {
    heading: "今日工作",
    items: [
      { to: "/today", label: "今日工作", icon: CalendarClock, exact: true },
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/work-queue", label: "Work Queue", icon: ListChecks },
    ],
  },
  {
    heading: "客戶與案件",
    items: [
      { to: "/annual-returns", label: "Annual Returns", icon: CalendarClock },
      { to: "/clients", label: "Clients", icon: Building2 },
      { to: "/incorporation", label: "Incorporation", icon: Rocket },
      { to: "/corporate-changes", label: "Corporate changes", icon: Repeat2 },
      { to: "/imports", label: "月表匯入", icon: Upload },
      { to: "/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    heading: "文件審閱",
    items: [
      { to: "/documents", label: "Documents", icon: FileText },
      { to: "/portal", label: "Portal", icon: ExternalLink },
    ],
  },
  {
    heading: "訊息",
    items: [
      { to: "/whatsapp", label: "WhatsApp Inbox", icon: MessageCircle, exact: true },
      { to: "/whatsapp/automation", label: "WhatsApp Automation", icon: Zap, nested: true },
    ],
  },
  {
    heading: "Administration",
    items: [
      { to: "/admin", label: "Admin", icon: ShieldCheck },
      // Staff-visible rather than admin-only: the question it answers is "can I
      // trust what the other screens are telling me", and the person who needs
      // that is whoever is about to rely on the chase list.
      { to: "/operations", label: "系統運作", icon: Activity },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
