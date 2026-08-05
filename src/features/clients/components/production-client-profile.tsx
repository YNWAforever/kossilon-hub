import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { getClient } from "../server-fns";
import type { ClientDetail, CompanyContact } from "../types";

type Props = {
  clientId: string;
  onEditClient: (client: ClientDetail) => void;
  onAddContact: () => void;
  onEditContact: (contact: CompanyContact) => void;
  onRemoveContact: (contact: CompanyContact) => void;
  removingContactId: string | null;
};

export function clientProfileQueryKey(clientId: string) {
  return ["clients", "profile", clientId] as const;
}

export function ProductionClientProfile({
  clientId,
  onEditClient,
  onAddContact,
  onEditContact,
  onRemoveContact,
  removingContactId,
}: Props) {
  const clientQuery = useQuery({
    queryKey: clientProfileQueryKey(clientId),
    queryFn: () => getClient({ data: { id: clientId } }),
  });

  if (clientQuery.isError) {
    return (
      <>
        <PageHeader eyebrow="Operations" title="Client" subtitle="Unavailable" />
        <main className="flex-1 p-6">
          <div className="rounded-xl border bg-card p-10 text-center">
            <p className="text-sm font-medium">This client is temporarily unavailable.</p>
            <button
              onClick={() => void clientQuery.refetch()}
              className="mt-4 rounded-md border px-3 py-2 text-sm font-medium"
            >
              Retry
            </button>
          </div>
        </main>
      </>
    );
  }

  const client = clientQuery.data;

  if (!clientQuery.isPending && !client) {
    return (
      <>
        <PageHeader eyebrow="Operations" title="Client not found" />
        <main className="flex-1 p-6">
          <p className="text-sm text-muted-foreground">
            No client exists with that id.{" "}
            <Link to="/clients" search={{ status: "active" }} className="text-primary underline">
              Back to the register
            </Link>
          </p>
        </main>
      </>
    );
  }

  if (!client) {
    return (
      <>
        <PageHeader eyebrow="Operations" title="Client" />
        <main className="flex-1 p-6 text-sm text-muted-foreground">Loading…</main>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title={client.companyName}
        subtitle={`BR ${client.brNumber} · CR ${client.crNumber} · ${client.packageName ?? "No package"} · ${client.teamName}${client.status === "inactive" ? " · Inactive" : ""}`}
        actions={
          <button
            onClick={() => onEditClient(client)}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50"
          >
            Edit client
          </button>
        }
      />

      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border bg-card p-5">
            <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Field label="AR deadline" value={client.arDueDate ?? "No case"} />
              <Field label="Owner" value={client.ownerName} />
              <Field
                label="Invoice"
                value={
                  client.invoiceAmount === null
                    ? "—"
                    : `HKD ${client.invoiceAmount.toLocaleString()}`
                }
              />
              <Field label="Payment" value={client.paymentStatus ?? "Not invoiced"} />
              <Field label="Registered office" value={client.registeredOffice} />
              <Field label="Company secretary" value={client.companySecretary} />
              <Field label="Incorporated" value={client.incorporationDate} />
              <Field label="AR basis date" value={client.annualReturnBasisDate} />
            </dl>
          </section>

          <section className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-semibold">Contacts</h2>
              <button
                onClick={onAddContact}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50"
              >
                <Plus className="h-3 w-3" /> Add contact
              </button>
            </div>
            <ul className="divide-y">
              {client.contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {contact.name}
                      {contact.isPrimary && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-primary">
                          Primary
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{contact.role}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    {contact.email && <span>{contact.email}</span>}
                    {contact.phone && <span>{contact.phone}</span>}
                    <button
                      onClick={() => onEditContact(contact)}
                      className="text-primary hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onRemoveContact(contact)}
                      disabled={removingContactId === contact.id}
                      className="text-destructive hover:underline disabled:opacity-60"
                    >
                      {removingContactId === contact.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
              {client.contacts.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No contacts recorded for this company.
                </li>
              )}
            </ul>
          </section>

          <section className="rounded-xl border bg-card">
            <div className="border-b px-5 py-3">
              <h2 className="font-semibold">Annual return history</h2>
            </div>
            <ul className="divide-y">
              {client.annualReturnHistory.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{entry.filingDueDate}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.returnYear} · made up {entry.madeUpDate} · {entry.currentStatus}
                    </p>
                  </div>
                  <Link
                    to="/annual-returns/$id"
                    params={{ id: entry.id }}
                    className="text-xs text-primary hover:underline"
                  >
                    Open case
                  </Link>
                </li>
              ))}
              {client.annualReturnHistory.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No annual return cases yet.
                </li>
              )}
            </ul>
          </section>

          <section className="rounded-xl border bg-card">
            <div className="border-b px-5 py-3">
              <h2 className="font-semibold">Documents</h2>
            </div>
            <ul className="divide-y">
              {client.documents.slice(0, 8).map((document) => (
                <li
                  key={document.id}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <span className="truncate">{document.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {document.verificationStatus}
                  </span>
                </li>
              ))}
              {client.documents.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No documents uploaded.
                </li>
              )}
            </ul>
          </section>
        </div>

        <section className="rounded-xl border bg-card">
          <div className="border-b px-5 py-3">
            <h2 className="font-semibold">Company timeline</h2>
          </div>
          <ul className="divide-y">
            {client.timeline.map((entry) => (
              <li key={entry.id} className="px-5 py-3">
                <p className="text-sm">{entry.description}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {entry.createdAt} ·{" "}
                  {entry.actorName ?? (entry.actorType === "system" ? "System" : "Unknown")}
                </p>
              </li>
            ))}
            {client.timeline.length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                No activity recorded yet.
              </li>
            )}
          </ul>
        </section>
      </main>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}
