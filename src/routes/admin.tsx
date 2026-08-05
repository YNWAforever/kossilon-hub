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
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/features/auth/auth-context-neon";
import { isAdmin, type AuthRole, type DemoUser } from "@/features/auth/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin - Kossilon CoSec OS" },
      {
        name: "description",
        content: "Manage prototype users, roles, and system settings.",
      },
    ],
  }),
  component: AdminPage,
});

type AdminTab = "users" | "system" | "audit";

const adminTabs: { value: AdminTab; label: string; icon: LucideIcon }[] = [
  { value: "users", label: "Users", icon: UserCog },
  { value: "system", label: "System settings", icon: Building2 },
  { value: "audit", label: "Audit preview", icon: Activity },
];

const auditRows = [
  {
    actor: "Amy Chan",
    action: "Opened admin console",
    area: "Admin",
    time: "2026-07-07 09:05",
  },
  {
    actor: "Amy Chan",
    action: "Reviewed WhatsApp API settings",
    area: "System settings",
    time: "2026-07-07 09:03",
  },
  {
    actor: "Ken Wong",
    action: "Signed in as Manager demo",
    area: "Authentication",
    time: "2026-07-06 17:30",
  },
  {
    actor: "Mei Lam",
    action: "Checked assigned annual-return cases",
    area: "Annual returns",
    time: "2026-07-06 16:20",
  },
];

/**
 * Every other screen branches on dataMode; this one never did. It rendered
 * `demoUsers` and a hardcoded `auditRows` unconditionally, so a production deploy
 * showed three invented staff members as the firm's roster alongside a fabricated
 * audit trail — and any access decision made from it was made against fiction.
 *
 * There is no production user-management data layer to branch to, so production
 * says so instead of inventing one. Fixtures now come from useAuth(), which
 * returns [] outside demo mode, rather than from a direct module import.
 */
function AdminPage() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? <DemoAdminConsole /> : <ProductionAdminConsole />;
}

function ProductionAdminConsole() {
  const { session } = useAuth();

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Administration"
        title="Admin"
        subtitle="User and system administration"
      />
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex max-w-2xl items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-status-yellow-soft">
            <ShieldCheck className="h-5 w-5 text-status-orange" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Not available in this deployment
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Staff accounts, roles and team membership are managed in Neon Auth and in the
              firm&rsquo;s <code className="font-mono text-xs">staff_profiles</code> table, not from
              this console. The prototype user list this screen used to show was fixture data and
              never reflected the firm&rsquo;s real users.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Signed in as {session?.name ?? "an authenticated user"} ({session?.role ?? "User"}).
            </p>
            <Link className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm" to="/">
              Back to dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
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
        <PageHeader eyebrow="Administration" title="Admin" subtitle="Restricted area" />
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex max-w-2xl items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-status-yellow-soft">
              <LockKeyhole className="h-5 w-5 text-status-orange" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-foreground">
                Admin access required
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {session?.name ?? "This user"} is signed in as {session?.role ?? "User"}. Prototype
                user and system controls are limited to Admin users.
              </p>
              <Link
                to="/"
                className="mt-4 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Administration" title="Admin" subtitle="Users, roles, system settings" />
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AdminMetric icon={Users} label="Demo users" value={localUsers.length} />
        <AdminMetric icon={CheckCircle2} label="Active users" value={activeUsers} />
        <AdminMetric icon={ShieldCheck} label="Admin users" value={adminUsers} />
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div
          className="flex flex-wrap gap-2 border-b border-border px-5 py-4"
          aria-label="Admin sections"
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
              User
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Role
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Team
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Last login
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Actions
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
                  onChange={(event) => onRoleChange(user.id, event.target.value as AuthRole)}
                  aria-label={`Role for ${user.name}`}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="Admin">Admin</option>
                  <option value="Manager">Manager</option>
                  <option value="Staff">Staff</option>
                </select>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{user.team}</td>
              <td className="px-4 py-3">
                <StatusPill tone={user.active ? "green" : "yellow"}>
                  {user.active ? "Active" : "Inactive"}
                </StatusPill>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatLastLogin(user.lastLoginAt)}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onSwitchUser(user.id)}
                    disabled={!user.active}
                    aria-label={`Sign in as ${user.name}`}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Sign in as
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleActive(user.id)}
                    aria-label={`${user.active ? "Deactivate" : "Activate"} ${user.name}`}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium transition hover:bg-accent"
                  >
                    {user.active ? "Deactivate" : "Activate"}
                  </button>
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
        title="Firm profile"
        value="Kossilon"
        detail="Company secretary operations workspace for annual-return filing, client evidence, and team follow-up."
      />
      <SystemCard
        icon={Package}
        title="Service packages"
        value="3 active packages"
        detail="Basic, Standard, and Premium annual-return service packages are available for prototype cases."
      />
      <SystemCard
        icon={MessageCircle}
        title="WhatsApp API"
        value="WOZTELL configured in Settings"
        detail="Channel routing and API key management remain in Settings for the connected WhatsApp inbox."
      />
      <SystemCard
        icon={KeyRound}
        title="Annual-return actor"
        value="Server env required"
        detail="Server-side filing actions still need the KOSSILON_ANNUAL_RETURN_ACTOR_ID environment value."
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
              Action
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Area
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Actor
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Time
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
  return new Date(value).toLocaleString("en-HK", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
