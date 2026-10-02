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
import type { AuthRole } from "@/features/auth/types";

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
  roles?: readonly AuthRole[];
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
      { to: "/", label: "總覽", icon: LayoutDashboard, exact: true },
      { to: "/work-queue", label: "工作隊列", icon: ListChecks },
    ],
  },
  {
    heading: "案件與客戶",
    items: [
      { to: "/annual-returns", label: "周年申報", icon: CalendarClock },
      { to: "/clients", label: "客戶", icon: Building2 },
      { to: "/incorporation", label: "公司註冊", icon: Rocket },
      { to: "/corporate-changes", label: "公司變更", icon: Repeat2 },
      { to: "/imports", label: "月表匯入", icon: Upload, roles: ["Admin", "Manager"] },
    ],
  },
  {
    heading: "文件與付款",
    items: [
      { to: "/documents", label: "文件", icon: FileText },
      { to: "/payments", label: "付款", icon: CreditCard },
      { to: "/portal", label: "客戶入口", icon: ExternalLink },
    ],
  },
  {
    heading: "通訊",
    items: [
      { to: "/whatsapp", label: "WhatsApp 收件箱", icon: MessageCircle, exact: true },
      { to: "/whatsapp/automation", label: "WhatsApp 追件", icon: Zap, nested: true },
    ],
  },
  {
    heading: "管理",
    items: [
      { to: "/admin", label: "用戶管理", icon: ShieldCheck, roles: ["Admin"] },
      // Staff-visible rather than admin-only: the question it answers is "can I
      // trust what the other screens are telling me", and the person who needs
      // that is whoever is about to rely on the chase list.
      { to: "/operations", label: "系統運作", icon: Activity },
      { to: "/settings", label: "設定", icon: Settings, roles: ["Admin"] },
    ],
  },
];

/** Presentation only; existing server policies remain authoritative. */
export function navGroupsForRole(role: AuthRole | undefined): NavGroup[] {
  if (!role) return [];
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        role === "Client"
          ? ["/documents", "/portal"].includes(item.to)
          : !item.roles || item.roles.includes(role),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
