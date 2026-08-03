import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ContactFormDialog } from "@/components/clients/contact-form-dialog";
import {
  getClient,
  listClientAssignmentOptions,
  removeClientContact,
} from "@/features/clients/server-fns";
import type {
  ClientAssignmentOptions,
  ClientDetail,
  CompanyContact,
} from "@/features/clients/types";
import { formatDate, formatDateTime } from "@/lib/mock-data";
import { Building2, CreditCard, FileText, Mail, MapPin, Phone, Plus } from "lucide-react";

type ClientDetailLoaderData = {
  client: ClientDetail;
  options: ClientAssignmentOptions;
};

export const Route = createFileRoute("/clients/$id")({
  loader: async ({ params }): Promise<ClientDetailLoaderData> => {
    const [client, options] = await Promise.all([
      getClient({ data: { id: params.id } }),
      listClientAssignmentOptions(),
    ]);

    if (!client) {
      throw notFound();
    }

    return { client, options };
  },
  head: () => ({
    meta: [
      { title: "Client — Kossilon CoSec OS" },
      {
        name: "description",
        content: "Client profile, annual return history, documents, and payment status.",
      },
    ],
  }),
  notFoundComponent: () => (
    <div className="p-10 text-center text-muted-foreground">
      Client not found.{" "}
      <Link to="/clients" className="text-primary underline">
        Back to clients
      </Link>
    </div>
  ),
  component: ClientProfilePage,
});

function paymentTone(status: ClientDetail["paymentStatus"]) {
  if (status === "Payment received") return "green" as const;
  if (status === "Overdue") return "red" as const;
  if (status === "Payment pending") return "yellow" as const;
  return "neutral" as const;
}

function ClientProfilePage() {
  const { client, options } = Route.useLoaderData() as ClientDetailLoaderData;
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CompanyContact | undefined>(undefined);
  const [removingContactId, setRemovingContactId] = useState<string | null>(null);

  function openAddContact() {
    setEditingContact(undefined);
    setContactOpen(true);
  }

  function openEditContact(contact: CompanyContact) {
    setEditingContact(contact);
    setContactOpen(true);
  }

  async function handleRemoveContact(contact: CompanyContact) {
    setRemovingContactId(contact.id);

    try {
      await removeClientContact({ data: { companyId: client.id, contactId: contact.id } });
      toast.success("Contact removed.");
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove the contact.");
    } finally {
      setRemovingContactId(null);
    }
  }

  return (
    <>
      <TopBar
        title={client.companyName}
        subtitle={`BR ${client.brNumber} · CR ${client.crNumber} · Incorporated ${formatDate(client.incorporationDate)}`}
        actions={
          <button
            onClick={() => setEditOpen(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
          >
            Edit client
          </button>
        }
      />

      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-display text-xl font-semibold text-foreground">
                    {client.companyName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {client.packageName ?? "No package"} · {client.teamName}
                    {client.status === "inactive" ? " · Inactive" : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={paymentTone(client.paymentStatus)}>
                  Payment · {client.paymentStatus ?? "Not invoiced"}
                </StatusPill>
                {client.arDueDate && <DeadlinePill dueDate={client.arDueDate} showDate />}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  AR deadline
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {client.arDueDate ? formatDate(client.arDueDate) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Owner</p>
                <p className="mt-1 font-medium text-foreground">{client.ownerName}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Invoice
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {client.invoiceAmount === null
                    ? "—"
                    : `HKD ${client.invoiceAmount.toLocaleString()}`}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Company secretary
                </p>
                <p className="mt-1 font-medium text-foreground">{client.companySecretary}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">Contacts</h2>
              <button
                onClick={openAddContact}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50"
              >
                <Plus className="h-3 w-3" /> Add contact
              </button>
            </div>
            <ul className="divide-y divide-border">
              {client.contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-foreground">
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
                    {contact.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {contact.email}
                      </span>
                    )}
                    {contact.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {contact.phone}
                      </span>
                    )}
                    <button
                      onClick={() => openEditContact(contact)}
                      className="text-primary hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleRemoveContact(contact)}
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
              <li className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {client.registeredOffice}
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">
                Annual return history
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {client.annualReturnHistory.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{formatDate(entry.filingDueDate)}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.returnYear} · made up {formatDate(entry.madeUpDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone="neutral">{entry.currentStatus}</StatusPill>
                    <Link
                      to="/annual-returns/$id"
                      params={{ id: entry.id }}
                      className="text-xs text-primary hover:underline"
                    >
                      Open case
                    </Link>
                  </div>
                </li>
              ))}
              {client.annualReturnHistory.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No annual return cases yet.
                </li>
              )}
            </ul>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-semibold">Documents</h3>
              </div>
              {client.documents.slice(0, 6).map((document) => (
                <div
                  key={document.id}
                  className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0"
                >
                  <span className="truncate text-foreground">{document.fileName}</span>
                  <StatusPill
                    tone={
                      document.verificationStatus === "verified"
                        ? "green"
                        : document.verificationStatus === "rejected"
                          ? "red"
                          : "yellow"
                    }
                  >
                    {document.verificationStatus}
                  </StatusPill>
                </div>
              ))}
              {client.documents.length === 0 && (
                <p className="text-sm text-muted-foreground">No documents uploaded.</p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-semibold">Payment</h3>
              </div>
              <div className="text-sm">
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Invoice amount</span>
                  <span className="font-medium">
                    {client.invoiceAmount === null
                      ? "—"
                      : `HKD ${client.invoiceAmount.toLocaleString()}`}
                  </span>
                </div>
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Status</span>
                  <StatusPill tone={paymentTone(client.paymentStatus)}>
                    {client.paymentStatus ?? "Not invoiced"}
                  </StatusPill>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Basis date</span>
                  <span className="font-medium">{formatDate(client.annualReturnBasisDate)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">
                Company timeline
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {client.timeline.map((entry) => (
                <li key={entry.id} className="px-5 py-3">
                  <p className="text-sm text-foreground">{entry.description}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {formatDateTime(entry.createdAt)} ·{" "}
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
          </div>
        </div>
      </main>

      <ClientFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        options={options}
        client={client}
        onSaved={() => router.invalidate()}
      />

      <ContactFormDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        companyId={client.id}
        contact={editingContact}
        onSaved={() => router.invalidate()}
      />
    </>
  );
}
