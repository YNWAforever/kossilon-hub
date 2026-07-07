import { Link, createFileRoute } from "@tanstack/react-router";

import { clients, enquiries } from "../lib/app-data";

export const Route = createFileRoute("/")({
  component: DashboardRoute,
});

function DashboardRoute() {
  const waitingDocs = clients.filter((client) => client.missingDocs.length > 0).length;
  const pendingPayments = clients.filter((client) => client.paymentStatus === "Pending").length;

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Today</p>
        <h1 className="mt-1 text-3xl font-semibold">Operations dashboard</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Open WhatsApp enquiries" value={enquiries.length} />
        <Metric label="Cases waiting documents" value={waitingDocs} />
        <Metric label="Pending payments" value={pendingPayments} />
      </div>
      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">AI reply drafting demo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open the WhatsApp inbox to try retrieval-grounded draft replies.
            </p>
          </div>
          <Link
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            to="/whatsapp"
          >
            Open inbox
          </Link>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </section>
  );
}
