import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { Timeline } from "@/components/timeline";
import { clients as commandCenterClients } from "@/lib/app-data";
import { cases, teamMembers, formatDate, type Company, type Contact } from "@/lib/mock-data";
import { getCompanyById, useCompanyById } from "@/lib/clients-store";
import { caseStatusTone } from "@/lib/status";
import { Building2, Mail, Phone, MapPin, FileText, CreditCard } from "lucide-react";

export const Route = createFileRoute("/clients/$id")({
  beforeLoad: ({ params }) => {
    if (!getCompanyById(params.id)) throw notFound();
  },
  head: () => ({
    meta: [
      { title: `Client — Kossilon CoSec OS` },
      {
        name: "description",
        content: `Client profile, annual return history, documents, and payment status.`,
      },
    ],
  }),
  component: ClientProfilePage,
});

function ClientProfilePage() {
  const { id } = Route.useParams();
  const company = useCompanyById(id);

  if (!company) {
    throw notFound();
  }

  const owner = teamMembers.find((t) => t.id === company.ownerId)!;
  const activeCase = cases.find((c) => c.companyId === company.id);
  const history = cases.filter((c) => c.companyId === company.id);
  const portalCaseId = getPortalCaseId(company);

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Clients"
        title={company.name}
        subtitle={`BR ${company.brNumber} · CR ${company.crNumber} · Incorporated ${formatDate(company.incorporated)}`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Header card */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-display text-xl font-semibold text-foreground">
                    {company.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {company.package} package · {company.team}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill
                  tone={
                    company.paymentStatus === "Paid"
                      ? "green"
                      : company.paymentStatus === "Pending"
                        ? "yellow"
                        : "red"
                  }
                >
                  Payment · {company.paymentStatus}
                </StatusPill>
                <DeadlinePill dueDate={company.arDueDate} showDate />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  AR deadline
                </p>
                <p className="mt-1 font-medium text-foreground">{formatDate(company.arDueDate)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Owner</p>
                <p className="mt-1 font-medium text-foreground">{owner.name}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Invoice
                </p>
                <p className="mt-1 font-medium text-foreground">
                  HKD {company.invoiceAmount.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Active case
                </p>
                {activeCase ? (
                  <div className="mt-1 flex flex-wrap gap-3">
                    <Link
                      to="/annual-returns"
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Open board →
                    </Link>
                    {portalCaseId ? (
                      <Link
                        to="/portal"
                        search={{ caseId: portalCaseId }}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        Open portal
                      </Link>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">—</p>
                )}
              </div>
            </div>
          </div>

          {/* Contacts */}
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">Contacts</h2>
            </div>
            <ul className="divide-y divide-border">
              {company.contacts.map((c: Contact) => (
                <li
                  key={c.email}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.role}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {c.email}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {c.phone}
                    </span>
                  </div>
                </li>
              ))}
              <li className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {company.address}
              </li>
            </ul>
          </div>

          {/* AR history */}
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">
                Annual return history
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {history.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{formatDate(c.dueDate)}</p>
                    <p className="text-xs text-muted-foreground">Next: {c.nextAction}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={caseStatusTone(c.status)}>{c.status}</StatusPill>
                    <Link to="/annual-returns" className="text-xs text-primary hover:underline">
                      Open board
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Docs + payments row */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-semibold">Documents</h3>
              </div>
              {activeCase?.checklist.slice(0, 4).map((i) => (
                <div
                  key={i.id}
                  className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0"
                >
                  <span className="text-foreground">{i.label}</span>
                  <StatusPill tone={i.received ? "green" : "yellow"}>
                    {i.received ? "Received" : "Missing"}
                  </StatusPill>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-semibold">Payment</h3>
              </div>
              <div className="text-sm">
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Invoice amount</span>
                  <span className="font-medium">HKD {company.invoiceAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Status</span>
                  <StatusPill
                    tone={
                      company.paymentStatus === "Paid"
                        ? "green"
                        : company.paymentStatus === "Pending"
                          ? "yellow"
                          : "red"
                    }
                  >
                    {company.paymentStatus}
                  </StatusPill>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Method</span>
                  <span className="font-medium">FPS / Bank transfer</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <Timeline events={company.timeline} title="Company timeline" />
        </div>
      </div>
    </main>
  );
}

function getPortalCaseId(company: Company): string | undefined {
  const primaryContact = company.contacts[0];
  return commandCenterClients.find(
    (candidate) =>
      candidate.companyName === company.name || candidate.phone === primaryContact?.phone,
  )?.annualReturnCaseId;
}
