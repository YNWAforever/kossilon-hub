import { createFileRoute, Link } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { teamMembers, formatDate } from "@/lib/mock-data";
import { useAllCompanies } from "@/lib/clients-store";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: "Clients — Kossilon CoSec OS" },
      { name: "description", content: "Client company directory with annual return deadlines, assigned team, and payment status." },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const companies = useAllCompanies();
  return (
    <>
      <TopBar
        title="Clients"
        subtitle={`${companies.length} companies under management`}
        actions={
          <button className="hidden md:inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> Add client
          </button>
        }
      />
      <main className="flex-1 p-6">
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <input placeholder="Search clients…" className="flex-1 min-w-40 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none" />
              <select className="rounded-md border border-border bg-background px-3 py-1.5 text-sm">
                <option>All packages</option><option>Basic</option><option>Standard</option><option>Premium</option>
              </select>
              <select className="rounded-md border border-border bg-background px-3 py-1.5 text-sm">
                <option>All teams</option><option>Filing Team A</option><option>Filing Team B</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-5 py-3 font-medium">BR / CR</th>
                  <th className="px-5 py-3 font-medium">Package</th>
                  <th className="px-5 py-3 font-medium">AR deadline</th>
                  <th className="px-5 py-3 font-medium">Payment</th>
                  <th className="px-5 py-3 font-medium">Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {companies.map((c) => {
                  const owner = teamMembers.find((t) => t.id === c.ownerId)!;
                  return (
                    <tr key={c.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <Link to="/clients/$id" params={{ id: c.id }} className="font-medium text-foreground hover:text-primary">
                          {c.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{c.team}</div>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground tabular-nums">
                        BR {c.brNumber}<br />CR {c.crNumber}
                      </td>
                      <td className="px-5 py-3"><StatusPill tone="neutral">{c.package}</StatusPill></td>
                      <td className="px-5 py-3">
                        <DeadlinePill dueDate={c.arDueDate} />
                        <div className="mt-1 text-[10px] text-muted-foreground">{formatDate(c.arDueDate)}</div>
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill tone={c.paymentStatus === "Paid" ? "green" : c.paymentStatus === "Pending" ? "yellow" : "red"}>
                          {c.paymentStatus}
                        </StatusPill>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-sand text-[10px] font-semibold text-white">{owner.initials}</div>
                          <span className="text-xs text-muted-foreground">{owner.name}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
