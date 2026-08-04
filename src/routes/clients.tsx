import { useMemo, useState } from "react";
import { createFileRoute, Link, Outlet, useMatchRoute, useRouter } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { listClientAssignmentOptions, listClients } from "@/features/clients/server-fns";
import type { ClientAssignmentOptions, ClientSummary } from "@/features/clients/types";
import { formatDate } from "@/lib/mock-data";
import { Plus } from "lucide-react";

type ClientsLoaderData = {
  clients: ClientSummary[];
  options: ClientAssignmentOptions;
  available: boolean;
  error: string | null;
};

const EMPTY_OPTIONS: ClientAssignmentOptions = { owners: [], teams: [], packages: [] };

async function loadClientDirectory(): Promise<ClientsLoaderData> {
  try {
    const [clients, options] = await Promise.all([listClients(), listClientAssignmentOptions()]);

    return { clients, options, available: true, error: null };
  } catch {
    return {
      clients: [],
      options: EMPTY_OPTIONS,
      available: false,
      error: "The client directory is temporarily unavailable.",
    };
  }
}

function isClientsIndexPath(pathname: string) {
  return pathname === "/clients" || pathname === "/clients/";
}

export const Route = createFileRoute("/clients")({
  loader: ({ location }) =>
    isClientsIndexPath(location.pathname)
      ? loadClientDirectory()
      : { clients: [], options: EMPTY_OPTIONS, available: true, error: null },
  head: () => ({
    meta: [
      { title: "Clients — Kossilon CoSec OS" },
      {
        name: "description",
        content:
          "Client company directory with annual return deadlines, assigned team, and payment status.",
      },
    ],
  }),
  component: ClientsPage,
});

function paymentTone(status: ClientSummary["paymentStatus"]) {
  if (status === "Payment received") return "green" as const;
  if (status === "Overdue") return "red" as const;
  if (status === "Payment pending") return "yellow" as const;
  return "neutral" as const;
}

function ClientsPage() {
  const matchRoute = useMatchRoute();
  const detailMatch = matchRoute({ to: "/clients/$id", fuzzy: false });
  const { clients, options, available, error } = Route.useLoaderData() as ClientsLoaderData;
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [packageFilter, setPackageFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [addOpen, setAddOpen] = useState(false);

  const packageNames = useMemo(
    () =>
      Array.from(
        new Set(
          clients
            .map((client) => client.packageName)
            .filter((name): name is string => Boolean(name)),
        ),
      ).sort(),
    [clients],
  );

  const teamNames = useMemo(
    () => Array.from(new Set(clients.map((client) => client.teamName))).sort(),
    [clients],
  );

  const visibleClients = useMemo(() => {
    const query = search.trim().toLowerCase();

    return clients.filter((client) => {
      if (statusFilter !== "all" && client.status !== statusFilter) return false;
      if (packageFilter !== "all" && client.packageName !== packageFilter) return false;
      if (teamFilter !== "all" && client.teamName !== teamFilter) return false;
      if (!query) return true;

      return (
        client.companyName.toLowerCase().includes(query) ||
        client.crNumber.toLowerCase().includes(query) ||
        client.brNumber.toLowerCase().includes(query) ||
        client.ownerName.toLowerCase().includes(query)
      );
    });
  }, [clients, search, packageFilter, teamFilter, statusFilter]);

  // `clients.$id` is a child of this route, so without this the directory would render in
  // place of the profile. Matches the pattern in annual-returns.tsx.
  if (detailMatch) {
    return <Outlet />;
  }

  return (
    <>
      <TopBar
        title="Clients"
        subtitle={
          available
            ? `${visibleClients.length} of ${clients.length} companies under management`
            : "Directory unavailable"
        }
        actions={
          <button
            onClick={() => setAddOpen(true)}
            disabled={!available}
            className="hidden items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 md:inline-flex"
          >
            <Plus className="h-3.5 w-3.5" /> Add client
          </button>
        }
      />
      <main className="flex-1 p-6">
        {!available ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <p className="text-sm font-medium text-foreground">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The register could not be reached. Existing clients are unaffected.
            </p>
            <button
              onClick={() => router.invalidate()}
              className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs font-medium"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search clients…"
                  className="min-w-40 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
                />
                <select
                  value={packageFilter}
                  onChange={(event) => setPackageFilter(event.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="all">All packages</option>
                  {packageNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={teamFilter}
                  onChange={(event) => setTeamFilter(event.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="all">All teams</option>
                  {teamNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as "active" | "inactive" | "all")
                  }
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="all">All statuses</option>
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
                  {visibleClients.map((client) => (
                    <tr key={client.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <Link
                          to="/clients/$id"
                          params={{ id: client.id }}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {client.companyName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {client.teamName}
                          {client.status === "inactive" ? " · Inactive" : ""}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs tabular-nums text-muted-foreground">
                        BR {client.brNumber}
                        <br />
                        CR {client.crNumber}
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill tone="neutral">{client.packageName ?? "—"}</StatusPill>
                      </td>
                      <td className="px-5 py-3">
                        {client.arDueDate ? (
                          <>
                            <DeadlinePill dueDate={client.arDueDate} />
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              {formatDate(client.arDueDate)}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No case</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill tone={paymentTone(client.paymentStatus)}>
                          {client.paymentStatus ?? "Not invoiced"}
                        </StatusPill>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-sand text-[10px] font-semibold text-white">
                            {client.ownerInitials}
                          </div>
                          <span className="text-xs text-muted-foreground">{client.ownerName}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visibleClients.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-10 text-center text-sm text-muted-foreground"
                      >
                        No clients match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <ClientFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        options={options}
        onSaved={() => router.invalidate()}
      />
    </>
  );
}
