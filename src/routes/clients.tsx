import { Link, createFileRoute } from "@tanstack/react-router";

import { clients } from "../lib/app-data";

export const Route = createFileRoute("/clients")({
  component: ClientsRoute,
});

function ClientsRoute() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">CRM</p>
        <h1 className="mt-1 text-3xl font-semibold">Clients</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {clients.map((client) => (
          <Link
            key={client.id}
            className="rounded-lg border bg-card p-5 hover:bg-muted"
            to="/clients/$id"
            params={{ id: client.id }}
          >
            <h2 className="font-semibold">{client.companyName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{client.contactName}</p>
            <p className="mt-3 text-sm">{client.status}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
