import { type ReactNode, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ContactFormDialog } from "@/components/clients/contact-form-dialog";
import { OfficerFormDialog } from "@/components/clients/officer-form-dialog";
import { ShareholdingFormDialog } from "@/components/clients/shareholding-form-dialog";
import {
  ceaseClientOfficer,
  ceaseClientShareholding,
  getClient,
  listClientAssignmentOptions,
  removeClientContact,
} from "../server-fns";
import type { ClientPaymentStatus, CompanyContact, CompanyStatus } from "../types";

const companyStatusTone: Record<CompanyStatus, StatusTone> = {
  active: "green",
  inactive: "neutral",
};

const paymentStatusTone: Record<ClientPaymentStatus, StatusTone> = {
  "Not invoiced": "neutral",
  "Payment pending": "yellow",
  "Payment received": "green",
  Overdue: "red",
};

const verificationTone: Record<"pending" | "verified" | "rejected", StatusTone> = {
  pending: "yellow",
  verified: "green",
  rejected: "red",
};

const officerTypeLabel: Record<"director" | "secretary", string> = {
  director: "Director",
  secretary: "Secretary",
};

export function ProductionClientDetail({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [contactDialog, setContactDialog] = useState<{ open: boolean; contact?: CompanyContact }>({
    open: false,
  });
  const [removingContactId, setRemovingContactId] = useState<string | null>(null);
  const [isOfficerDialogOpen, setIsOfficerDialogOpen] = useState(false);
  const [isShareholdingDialogOpen, setIsShareholdingDialogOpen] = useState(false);
  const [ceasingOfficerId, setCeasingOfficerId] = useState<string | null>(null);
  const [ceasingShareholdingId, setCeasingShareholdingId] = useState<string | null>(null);

  const clientQuery = useQuery({
    queryKey: ["clients", clientId],
    queryFn: () => getClient({ data: { id: clientId } }),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["clients", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  }

  async function handleRemoveContact(contactId: string) {
    setRemovingContactId(contactId);

    try {
      await removeClientContact({ data: { companyId: clientId, contactId } });
      invalidate();
    } catch {
      toast.error("Unable to remove the contact. Try again.");
    } finally {
      setRemovingContactId(null);
    }
  }

  async function handleCeaseOfficer(officerId: string) {
    setCeasingOfficerId(officerId);

    try {
      await ceaseClientOfficer({
        data: {
          companyId: clientId,
          officerId,
          cessationDate: new Date().toISOString().slice(0, 10),
        },
      });
      invalidate();
    } catch {
      toast.error("Unable to cease the officer. Try again.");
    } finally {
      setCeasingOfficerId(null);
    }
  }

  async function handleCeaseShareholding(shareholdingId: string) {
    setCeasingShareholdingId(shareholdingId);

    try {
      await ceaseClientShareholding({
        data: {
          companyId: clientId,
          shareholdingId,
          cessationDate: new Date().toISOString().slice(0, 10),
        },
      });
      invalidate();
    } catch {
      toast.error("Unable to cease the shareholding. Try again.");
    } finally {
      setCeasingShareholdingId(null);
    }
  }

  if (clientQuery.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
        Loading client
      </div>
    );
  }

  if (clientQuery.isError) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Client" title="Client unavailable" />
        <p role="alert" className="text-sm text-destructive">
          Client data is unavailable. Try again shortly.
        </p>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/clients">
          Back to clients
        </Link>
      </main>
    );
  }

  const client = clientQuery.data;

  if (!client) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Client" title="Client not found" />
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/clients">
          Back to clients
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Client"
        title={client.companyName}
        subtitle={`CR ${client.crNumber} · BR ${client.brNumber}`}
        actions={
          optionsQuery.data ? (
            <button
              type="button"
              onClick={() => setIsEditOpen(true)}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Edit
            </button>
          ) : null
        }
      />

      {optionsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow">
          Owner, team and package options are unavailable. Edit is disabled until this loads.
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-3">
        <Detail
          label="Status"
          value={<StatusPill tone={companyStatusTone[client.status]}>{client.status}</StatusPill>}
        />
        <Detail label="Owner" value={client.ownerName} />
        <Detail label="Team" value={client.teamName} />
        <Detail label="Package" value={client.packageName ?? "No package"} />
        <Detail label="Incorporation date" value={client.incorporationDate} />
        <Detail label="AR basis date" value={client.annualReturnBasisDate} />
        <Detail label="Registered office" value={client.registeredOffice} />
        <Detail label="Company secretary" value={client.companySecretary} />
        <Detail
          label="Latest payment"
          value={
            client.paymentStatus ? (
              <StatusPill tone={paymentStatusTone[client.paymentStatus]}>
                {client.paymentStatus}
              </StatusPill>
            ) : (
              "No case yet"
            )
          }
        />
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Officers</h2>
          <button
            type="button"
            onClick={() => setIsOfficerDialogOpen(true)}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Appoint officer
          </button>
        </div>
        <div className="divide-y">
          {client.officers.map((officer) => (
            <div key={officer.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {officer.name}
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {officerTypeLabel[officer.officerType]}
                  </span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Appointed {officer.appointmentDate}
                  {officer.cessationDate ? ` · Ceased ${officer.cessationDate}` : ""}
                  {officer.identificationNumber ? ` · ${officer.identificationNumber}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={officer.cessationDate ? "neutral" : "green"}>
                  {officer.cessationDate ? "Ceased" : "Active"}
                </StatusPill>
                {!officer.cessationDate ? (
                  <button
                    type="button"
                    onClick={() => void handleCeaseOfficer(officer.id)}
                    disabled={ceasingOfficerId === officer.id}
                    className="rounded-md border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    Cease
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {client.officers.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No officers on file.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Shareholders</h2>
          <button
            type="button"
            onClick={() => setIsShareholdingDialogOpen(true)}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Record shareholding
          </button>
        </div>
        <div className="divide-y">
          {client.shareholdings.map((shareholding) => (
            <div key={shareholding.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{shareholding.shareholderName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {shareholding.numberOfShares} {shareholding.shareClass} shares · Allotted{" "}
                  {shareholding.allotmentDate}
                  {shareholding.cessationDate ? ` · Ceased ${shareholding.cessationDate}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={shareholding.cessationDate ? "neutral" : "green"}>
                  {shareholding.cessationDate ? "Ceased" : "Active"}
                </StatusPill>
                {!shareholding.cessationDate ? (
                  <button
                    type="button"
                    onClick={() => void handleCeaseShareholding(shareholding.id)}
                    disabled={ceasingShareholdingId === shareholding.id}
                    className="rounded-md border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    Cease
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {client.shareholdings.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No shareholdings on file.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Contacts</h2>
          <button
            type="button"
            onClick={() => setContactDialog({ open: true })}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Add contact
          </button>
        </div>
        <div className="divide-y">
          {client.contacts.map((contact) => (
            <div key={contact.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {contact.name}
                  {contact.isPrimary ? (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                      Primary
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {contact.role} · {contact.email ?? contact.phone ?? "No contact details"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setContactDialog({ open: true, contact })}
                  className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemoveContact(contact.id)}
                  disabled={removingContactId === contact.id}
                  className="rounded-md border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {client.contacts.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No contacts on file.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Annual return history</h2>
        <div className="divide-y">
          {client.annualReturnHistory.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <span>Return year {entry.returnYear}</span>
              <span className="text-muted-foreground">Made up {entry.madeUpDate}</span>
              <span className="text-muted-foreground">Due {entry.filingDueDate}</span>
              <span>{entry.currentStatus}</span>
              <Link
                className="rounded-md border px-2 py-1 text-xs"
                to="/annual-returns/$id"
                params={{ id: entry.id }}
              >
                Open case
              </Link>
            </div>
          ))}
          {client.annualReturnHistory.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No annual return cases yet.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Documents</h2>
        <div className="divide-y">
          {client.documents.map((document) => (
            <div
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <span className="truncate">{document.fileName}</span>
              <span className="text-muted-foreground">{document.fileType}</span>
              <StatusPill tone={verificationTone[document.verificationStatus]}>
                {document.verificationStatus}
              </StatusPill>
              <span className="text-muted-foreground">{document.uploadedAt.slice(0, 10)}</span>
            </div>
          ))}
          {client.documents.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No documents on file.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
        <div className="divide-y">
          {client.timeline.map((entry) => (
            <div key={entry.id} className="py-3 text-sm">
              <p>{entry.description}</p>
              <p className="text-xs text-muted-foreground">
                {entry.actorName ?? "System"} · {new Date(entry.createdAt).toLocaleString("en-HK")}
              </p>
            </div>
          ))}
          {client.timeline.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No activity yet.</p>
          ) : null}
        </div>
      </section>

      {optionsQuery.data ? (
        <ClientFormDialog
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          options={optionsQuery.data}
          client={client}
          onSaved={invalidate}
        />
      ) : null}

      <ContactFormDialog
        open={contactDialog.open}
        onOpenChange={(open) => setContactDialog((current) => ({ ...current, open }))}
        companyId={clientId}
        contact={contactDialog.contact}
        onSaved={() => {
          invalidate();
          setContactDialog({ open: false });
        }}
      />

      <OfficerFormDialog
        open={isOfficerDialogOpen}
        onOpenChange={setIsOfficerDialogOpen}
        companyId={clientId}
        onSaved={invalidate}
      />

      <ShareholdingFormDialog
        open={isShareholdingDialogOpen}
        onOpenChange={setIsShareholdingDialogOpen}
        companyId={clientId}
        onSaved={invalidate}
      />
    </main>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
