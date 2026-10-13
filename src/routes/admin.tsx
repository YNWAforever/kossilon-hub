import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Activity,
  Building2,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  Package,
  ShieldCheck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { ProductionStaffAdmin } from "@/features/admin/production-staff-admin";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context-neon";
import { isAdmin, type AuthRole, type DemoUser } from "@/features/auth/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "用戶管理 — Kossilon CoSec OS" },
      {
        name: "description",
        content: "管理原型用戶、角色及系統設定。",
      },
    ],
  }),
  component: AdminPage,
});

type AdminTab = "users" | "system" | "audit";

const adminTabs: { value: AdminTab; label: string; icon: LucideIcon }[] = [
  { value: "users", label: "用戶", icon: UserCog },
  { value: "system", label: "系統設定", icon: Building2 },
  { value: "audit", label: "審計記錄預覽", icon: Activity },
];

const auditRows = [
  {
    actor: "Amy Chan",
    action: "開啟用戶管理",
    area: "用戶管理",
    time: "2026-07-07 09:05",
  },
  {
    actor: "Amy Chan",
    action: "查閱 WhatsApp API 設定",
    area: "系統設定",
    time: "2026-07-07 09:03",
  },
  {
    actor: "Ken Wong",
    action: "以經理示範帳戶登入",
    area: "登入驗證",
    time: "2026-07-06 17:30",
  },
  {
    actor: "Mei Lam",
    action: "查看已分配的周年申報案件",
    area: "周年申報",
    time: "2026-07-06 16:20",
  },
];

const roleLabels: Record<AuthRole, string> = {
  Admin: "管理員",
  Manager: "經理",
  Staff: "同事",
  Client: "客戶",
};

function roleLabel(role: string | undefined): string {
  return role ? (roleLabels[role as AuthRole] ?? role) : "用戶";
}

/** Production reads verified staff profiles; demo fixtures stay in the demo console. */
function AdminPage() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? <DemoAdminConsole /> : <ProductionAdminConsole />;
}

function ProductionAdminConsole() {
  const { session, isCurrentUserAdmin } = useAuth();
  const { actor } = Route.useRouteContext();

  if (!isCurrentUserAdmin) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <PageHeader eyebrow="管理" title="用戶管理" subtitle="限制存取" />
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex max-w-2xl items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-status-yellow-soft">
              <LockKeyhole className="h-5 w-5 text-status-orange-text" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-foreground">
                須具備管理員權限
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {session?.name ?? "此用戶"}目前以「{roleLabel(session?.role)}
                」身分登入。只有管理員可使用用戶管理。
              </p>
              <Button asChild variant="primary" className="mt-4">
                <Link to="/">返回總覽</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <ProductionStaffAdmin
      actorScope={JSON.stringify({ actor, sessionId: session?.id, role: session?.role })}
    />
  );
}

function DemoAdminConsole() {
  const { session, loginDemoUser, demoUsers } = useAuth();
  const [tab, setTab] = useState<AdminTab>("users");
  const [localUsers, setLocalUsers] = useState<DemoUser[]>(() => [...demoUsers]);
  const canAdmin = isAdmin(session);

  const activeUsers = useMemo(() => localUsers.filter((user) => user.active).length, [localUsers]);
  const adminUsers = useMemo(
    () => localUsers.filter((user) => user.role === "Admin").length,
    [localUsers],
  );

  function toggleActive(userId: string) {
    setLocalUsers((users) =>
      users.map((user) => (user.id === userId ? { ...user, active: !user.active } : user)),
    );
  }

  function changeRole(userId: string, role: AuthRole) {
    setLocalUsers((users) => users.map((user) => (user.id === userId ? { ...user, role } : user)));
  }

  if (!canAdmin) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <PageHeader eyebrow="管理" title="用戶管理" subtitle="限制存取" />
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex max-w-2xl items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-status-yellow-soft">
              <LockKeyhole className="h-5 w-5 text-status-orange-text" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-foreground">
                須具備管理員權限
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {session?.name ?? "此用戶"}目前以「{roleLabel(session?.role)}
                」身分登入。只有管理員可使用原型的用戶及系統控制。
              </p>
              <Button asChild variant="primary" className="mt-4">
                <Link to="/">返回總覽</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="管理" title="用戶管理" subtitle="用戶、角色及系統設定" />
      <p className="text-sm text-muted-foreground">
        示範帳戶資料只供查閱，角色及啟用狀態不可修改。
      </p>
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AdminMetric icon={Users} label="示範用戶" value={localUsers.length} />
        <AdminMetric icon={CheckCircle2} label="啟用中用戶" value={activeUsers} />
        <AdminMetric icon={ShieldCheck} label="管理員" value={adminUsers} />
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div
          className="flex flex-wrap gap-2 border-b border-border px-5 py-4"
          aria-label="用戶管理分頁"
        >
          {adminTabs.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition",
                tab === value
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === "users" && (
            <UsersPanel
              users={localUsers}
              onToggleActive={toggleActive}
              onRoleChange={changeRole}
              onSwitchUser={(userId) => {
                const user = localUsers.find((candidate) => candidate.id === userId);
                if (user?.active) loginDemoUser(user);
              }}
            />
          )}
          {tab === "system" && <SystemPanel />}
          {tab === "audit" && <AuditPanel />}
        </div>
      </section>
    </main>
  );
}

function AdminMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-3 font-display text-3xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function UsersPanel({
  users,
  onToggleActive,
  onRoleChange,
  onSwitchUser,
}: {
  users: DemoUser[];
  onToggleActive: (id: string) => void;
  onRoleChange: (id: string, role: AuthRole) => void;
  onSwitchUser: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              用戶
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              角色
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              團隊
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              狀態
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              最近登入
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              操作
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {users.map((user) => (
            <tr key={user.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sand text-xs font-semibold text-white">
                    {user.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <select
                  value={user.role}
                  disabled
                  onChange={(event) => onRoleChange(user.id, event.target.value as AuthRole)}
                  aria-label={`${user.name} 的角色`}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="Admin">{roleLabels.Admin}</option>
                  <option value="Manager">{roleLabels.Manager}</option>
                  <option value="Staff">{roleLabels.Staff}</option>
                </select>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{user.team}</td>
              <td className="px-4 py-3">
                <StatusPill tone={user.active ? "green" : "yellow"}>
                  {user.active ? "已啟用" : "已停用"}
                </StatusPill>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatLastLogin(user.lastLoginAt)}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onSwitchUser(user.id)}
                    disabled={!user.active}
                    aria-label={`以 ${user.name} 身分登入`}
                  >
                    以此身分登入
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled
                    onClick={() => onToggleActive(user.id)}
                    aria-label={`${user.active ? "停用" : "啟用"} ${user.name}`}
                  >
                    {user.active ? "停用" : "啟用"}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SystemPanel() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SystemCard
        icon={Building2}
        title="公司資料"
        value="Kossilon"
        detail="公司秘書營運工作區，處理周年申報遞交、客戶證明文件及團隊跟進。"
      />
      <SystemCard
        icon={Package}
        title="服務套餐"
        value="3 個啟用中套餐"
        detail="原型案件可使用基本、標準及尊尚三個周年申報服務套餐。"
      />
      <SystemCard
        icon={MessageCircle}
        title="WhatsApp API"
        value="WOZTELL 於「設定」配置"
        detail="已連接的 WhatsApp 收件箱，其渠道路由及 API 金鑰管理仍在「設定」處理。"
      />
      <SystemCard
        icon={KeyRound}
        title="周年申報操作者"
        value="須設定伺服器環境變數"
        detail="伺服器端的遞交操作仍需要 KOSSILON_ANNUAL_RETURN_ACTOR_ID 環境變數。"
      />
    </div>
  );
}

function SystemCard({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function AuditPanel() {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              操作
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              範疇
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              操作者
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              時間
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {auditRows.map((row) => (
            <tr key={`${row.actor}-${row.action}-${row.time}`} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium text-foreground">{row.action}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.area}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.actor}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatLastLogin(value: string) {
  return new Date(value).toLocaleString("zh-HK", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
