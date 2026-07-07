import { Link, createFileRoute } from "@tanstack/react-router";

import { enquiries } from "../lib/app-data";

export const Route = createFileRoute("/enquiries")({
  component: EnquiriesRoute,
});

function EnquiriesRoute() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Pipeline</p>
        <h1 className="mt-1 text-3xl font-semibold">Enquiries</h1>
      </div>
      <div className="rounded-lg border bg-card">
        {enquiries.map((enquiry) => (
          <div
            key={enquiry.id}
            className="flex items-center justify-between gap-3 border-b p-4 last:border-b-0"
          >
            <div>
              <p className="font-medium">{enquiry.name}</p>
              <p className="text-sm text-muted-foreground">
                {enquiry.intent} - {enquiry.status}
              </p>
            </div>
            <Link
              className="rounded-md border px-3 py-2 text-sm"
              to="/whatsapp"
              search={{ enquiry: enquiry.id }}
            >
              Open
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
