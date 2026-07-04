import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { teams, teamMembers } from "@/lib/mock-data";
import { Users, Crown } from "lucide-react";

export const Route = createFileRoute("/teams")({
  head: () => ({
    meta: [
      { title: "Teams — Kossilon CoSec OS" },
      { name: "description", content: "Teams, members, roles, permissions, and client ownership." },
    ],
  }),
  component: TeamsPage,
});

function TeamsPage() {
  return (
    <>
      <TopBar title="Team Management" subtitle={`${teams.length} teams · ${teamMembers.length} members`} />
      <main className="flex-1 space-y-6 p-6">
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {teams.map((t) => (
            <div key={t.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-display text-base font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground"><Crown className="mr-1 inline h-3 w-3" />Lead: {t.lead}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Members</p>
                  <p className="mt-1 font-display text-xl font-semibold">{t.memberIds.length}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Clients</p>
                  <p className="mt-1 font-display text-xl font-semibold">{t.clientCount}</p>
                </div>
              </div>
            </div>
          ))}
        </section>

        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-display text-base font-semibold text-foreground">All members</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Team</th>
                <th className="px-5 py-3 font-medium">Clients owned</th>
                <th className="px-5 py-3 font-medium">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {teamMembers.map((m) => (
                <tr key={m.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sand text-xs font-semibold text-white">{m.initials}</div>
                      <span className="font-medium text-foreground">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill tone={m.role === "Admin" ? "blue" : m.role === "Manager" ? "green" : "neutral"}>{m.role}</StatusPill>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{m.team}</td>
                  <td className="px-5 py-3 tabular-nums font-medium">{m.clientsOwned}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{m.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-semibold text-foreground">Roles & permissions</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
            <div className="rounded-lg border border-border p-3">
              <StatusPill tone="blue">Admin</StatusPill>
              <p className="mt-2 text-xs text-muted-foreground">Full access — settings, team management, billing, all clients.</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <StatusPill tone="green">Manager</StatusPill>
              <p className="mt-2 text-xs text-muted-foreground">Assign cases, view all clients in their teams, approve filings.</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <StatusPill tone="neutral">Staff</StatusPill>
              <p className="mt-2 text-xs text-muted-foreground">Handle assigned clients, chase documents, update case status.</p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
