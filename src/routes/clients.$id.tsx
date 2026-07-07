import { Link, createFileRoute } from "@tanstack/react-router";

import { clients, findEnquiryForClient } from "../lib/app-data";

export const Route = createFileRoute("/clients/$id")({
  component: ClientDetailRoute,
});

function ClientDetailRoute() {
  const { id } = Route.useParams();
  const client = clients.find((candidate) => candidate.id === id) ?? clients[0];
  const enquiry = client ? findEnquiryForClient(client.id) : undefined;

  if (!client) return null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Client</p>
          <h1 className="mt-1 text-3xl font-semibold">{client.companyName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {client.contactName} - {client.phone}
          </p>
        </div>
        {enquiry ? (
          <Link
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            to="/whatsapp"
            search={{ enquiry: enquiry.id }}
          >
            Open enquiry
          </Link>
        ) : null}
      </div>
      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-lg font-semibold">Active annual return</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Due {client.dueDate} - {client.paymentStatus}
        </p>
        <Link
          className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm"
          to="/annual-returns/$id"
          params={{ id: client.annualReturnCaseId }}
        >
          Open case
        </Link>
      </section>
    </div>
  );
}
