import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { listClients } from "../server-fns";
import type { ClientRegisterSearch } from "../board-filters";
import type { ClientSummary } from "../types";

export const CLIENT_REGISTER_QUERY_KEY = ["clients", "register"] as const;

type Props = {
  search: ClientRegisterSearch;
  onSearchChange: (next: ClientRegisterSearch) => void;
  canManage: boolean;
  onAddClient: () => void;
};

function paymentLabel(client: ClientSummary): string {
  return client.paymentStatus ?? "Not invoiced";
}

function paymentToneClass(client: ClientSummary): string {
  if (client.paymentStatus === "Payment received") return "text-status-green";
  if (client.paymentStatus === "Overdue") return "text-status-red";
  if (client.paymentStatus === "Payment pending") return "text-status-yellow";
  return "text-muted-foreground";
}

export function ProductionClientDirectory({
  search,
  onSearchChange,
  canManage,
  onAddClient,
}: Props) {
  const clientsQuery = useQuery({
    queryKey: CLIENT_REGISTER_QUERY_KEY,
    queryFn: () => listClients(),
  });

  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);

  const packageNames = useMemo(
    () =>
      Array.from(
        new Set(clients.map((c) => c.packageName).filter((n): n is string => Boolean(n))),
      ).sort(),
    [clients],
  );

  const teamNames = useMemo(
    () => Array.from(new Set(clients.map((c) => c.teamName))).sort(),
    [clients],
  );

  const visible = useMemo(() => {
    const query = search.q?.trim().toLowerCase() ?? "";

    return clients.filter((client) => {
      if (search.status !== "all" && client.status !== search.status) return false;
      if (search.packageName && client.packageName !== search.packageName) return false;
      if (search.teamName && client.teamName !== search.teamName) return false;
      if (!query) return true;

      return (
        client.companyName.toLowerCase().includes(query) ||
        client.crNumber.toLowerCase().includes(query) ||
        client.brNumber.toLowerCase().includes(query) ||
        client.ownerName.toLowerCase().includes(query)
      );
    });
  }, [clients, search]);

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Clients"
        subtitle={
          clientsQuery.isError
            ? "Register unavailable"
            : `${visible.length} of ${clients.length} companies under management`
        }
        actions={
          canManage ? (
            <button
              onClick={onAddClient}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Add client
            </button>
          ) : undefined
        }
      />

      <main className="flex-1 p-6">
        {clientsQuery.isError ? (
          <div className="rounded-xl border bg-card p-10 text-center">
            <p className="text-sm font-medium">The client register is temporarily unavailable.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No clients were changed. Retry when the connection recovers.
            </p>
            <button
              onClick={() => void clientsQuery.refetch()}
              className="mt-4 rounded-md border px-3 py-2 text-sm font-medium"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
              <input
                aria-label="Search clients"
                placeholder="Search clients…"
                value={search.q ?? ""}
                onChange={(event) =>
                  onSearchChange({ ...search, q: event.target.value || undefined })
                }
                className="min-w-40 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none"
              />
              <select
                aria-label="Filter by package"
                value={search.packageName ?? "all"}
                onChange={(event) =>
                  onSearchChange({
                    ...search,
                    packageName: event.target.value === "all" ? undefined : event.target.value,
                  })
                }
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">All packages</option>
                {packageNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by team"
                value={search.teamName ?? "all"}
                onChange={(event) =>
                  onSearchChange({
                    ...search,
                    teamName: event.target.value === "all" ? undefined : event.target.value,
                  })
                }
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">All teams</option>
                {teamNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by status"
                value={search.status}
                onChange={(event) =>
                  onSearchChange({
                    ...search,
                    status: event.target.value as ClientRegisterSearch["status"],
                  })
                }
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All statuses</option>
              </select>
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
                <tbody className="divide-y">
                  {visible.map((client) => (
                    <tr key={client.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <Link
                          to="/clients/$id"
                          params={{ id: client.id }}
                          className="font-medium hover:text-primary"
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
                      <td className="px-5 py-3">{client.packageName ?? "—"}</td>
                      <td className="px-5 py-3">
                        {client.arDueDate ?? <span className="text-muted-foreground">No case</span>}
                      </td>
                      <td className={`px-5 py-3 ${paymentToneClass(client)}`}>
                        {paymentLabel(client)}
                      </td>
                      <td className="px-5 py-3">{client.ownerName}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && !clientsQuery.isPending && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
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
    </>
  );
}
