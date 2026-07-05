import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bell,
  Check,
  ClipboardList,
  FileText,
  Lock,
  Receipt,
  Shield,
  Upload,
} from "lucide-react";
import { DeadlinePill } from "@/components/deadline-pill";
import { StatusPill } from "@/components/status-pill";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import {
  buildAnnualReturnReminderDraft,
  getAnnualReturnCase,
  recordAnnualReturnReminder,
  updateAnnualReturnChecklistItem,
  updateAnnualReturnFilingProof,
  updateAnnualReturnPayment,
  updateAnnualReturnStatus,
} from "@/features/annual-return/server-fns";
import type {
  AnnualReturnCase,
  AnnualReturnChecklistItem,
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "@/features/annual-return/types";
import { completionBlockers } from "@/features/annual-return/workflow";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/status";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

type ActionKey =
  | "complete"
  | "filing-proof"
  | "payment-pending"
  | "payment-overdue"
  | "payment-received"
  | "reminder"
  | `checklist-${string}-${ChecklistStatus}`;

export const Route = createFileRoute("/annual-returns/$id")({
  loader: async ({ params }) => {
    const c = await getAnnualReturnCase({ data: { id: params.id } });

    if (!c) {
      throw notFound();
    }

    return { c };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.c.companyName ?? "Case"} - Annual Return` },
      {
        name: "description",
        content: "Annual return case checklist, payment, filing proof, and reminder controls.",
      },
    ],
  }),
  component: CaseDetailPage,
  notFoundComponent: () => (
    <div className="p-10 text-center text-muted-foreground">
      Case not found.{" "}
      <Link to="/annual-returns" className="text-primary underline">
        Back to board
      </Link>
    </div>
  ),
});

function CaseDetailPage() {
  const { c } = Route.useLoaderData() as { c: AnnualReturnCase };
  const blockers = useMemo(() => completionBlockers(c), [c]);
  const [pending, setPending] = useState<ActionKey | null>(null);
  const locked = isLocked(c);
  const missing = c.checklist.filter((item) => item.required && item.status !== "Verified").length;
  const received = c.checklist.length - missing;
  const checklistProgress = c.checklist.length === 0 ? 100 : (received / c.checklist.length) * 100;

  async function runCaseAction(actionKey: ActionKey, action: () => Promise<void>) {
    setPending(actionKey);

    try {
      await action();
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to update annual return case.");
      setPending(null);
    }
  }

  async function handleReminder() {
    const recipientName = promptRequired("Recipient name", c.companyName);

    if (!recipientName) {
      return;
    }

    const recipientPhone = promptRequired("Recipient phone");

    if (!recipientPhone) {
      return;
    }

    await runCaseAction("reminder", async () => {
      const { draftBody } = await buildAnnualReturnReminderDraft({ data: { caseId: c.id } });
      await copyDraftToClipboard(draftBody);
      await recordAnnualReturnReminder({
        data: {
          caseId: c.id,
          templateLabel: "Annual return manual reminder",
          recipientName,
          recipientPhone,
          draftBody,
          note: "Recorded from annual return case detail.",
        },
      });
    });
  }

  async function handleChecklistStatus(item: AnnualReturnChecklistItem, status: ChecklistStatus) {
    let documentId = status === "Missing" ? null : item.documentId;

    if (status === "Verified" && !documentId) {
      documentId = promptRequired("Verified annual return evidence document UUID");

      if (!documentId) {
        return;
      }
    }

    await runCaseAction(`checklist-${item.id}-${status}`, async () => {
      await updateAnnualReturnChecklistItem({
        data: {
          caseId: c.id,
          itemId: item.id,
          status,
          documentId,
        },
      });
    });
  }

  async function handlePaymentStatus(status: PaymentStatus) {
    if (!c.payment) {
      return;
    }

    let paymentProofDocumentId =
      status === "Payment received" ? c.payment.paymentProofDocumentId : null;

    if (status === "Payment received" && !paymentProofDocumentId) {
      paymentProofDocumentId = promptRequired("Verified payment proof document UUID");

      if (!paymentProofDocumentId) {
        return;
      }
    }

    const actionKey =
      status === "Payment received"
        ? "payment-received"
        : status === "Overdue"
          ? "payment-overdue"
          : "payment-pending";

    await runCaseAction(actionKey, async () => {
      await updateAnnualReturnPayment({
        data: {
          caseId: c.id,
          status,
          paymentProofDocumentId,
        },
      });
    });
  }

  async function handleFilingProof() {
    const filingReference = promptRequired("Filing reference", c.filingReference ?? "");

    if (!filingReference) {
      return;
    }

    const confirmationDocumentId = promptRequired(
      "Verified filing confirmation document UUID",
      c.confirmationDocumentId ?? "",
    );

    if (!confirmationDocumentId) {
      return;
    }

    await runCaseAction("filing-proof", async () => {
      await updateAnnualReturnFilingProof({
        data: {
          caseId: c.id,
          filingReference,
          confirmationDocumentId,
        },
      });
    });
  }

  async function handleComplete() {
    if (blockers.length > 0) {
      return;
    }

    await runCaseAction("complete", async () => {
      await updateAnnualReturnStatus({ data: { caseId: c.id, nextStatus: "Completed" } });
    });
  }

  return (
    <>
      <TopBar
        title={c.companyName}
        subtitle={`Return year ${c.returnYear} · Case ${shortId(c.id)} · Due ${formatDateOnly(c.filingDueDate)}`}
        actions={
          <div className="hidden items-center gap-2 lg:flex">
            <StatusPill tone={annualReturnStatusTone(c.currentStatus)}>
              {c.currentStatus}
            </StatusPill>
            <DeadlinePill dueDate={c.filingDueDate} />
            <RiskPill risk={c.riskLevel} />
          </div>
        }
      />

      <main className="grid flex-1 grid-cols-1 gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/annual-returns"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Back to annual returns
            </Link>
            {locked && (
              <StatusPill tone="blue" className="shrink-0">
                <Lock className="h-3 w-3" />
                Locked
              </StatusPill>
            )}
          </div>

          <Panel title="Case Summary" icon={<Shield className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Deadline"
                value={<DeadlinePill dueDate={c.filingDueDate} showDate />}
              />
              <Metric label="Checklist received" value={`${received}/${c.checklist.length}`} />
              <Metric label="Missing required" value={missing.toString()} />
              <Metric label="Payment" value={c.payment?.status ?? "Not invoiced"} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-status-green"
                style={{ width: `${checklistProgress}%` }}
              />
            </div>
          </Panel>

          <Panel
            title="Completion Blockers"
            icon={<AlertTriangle className="h-4 w-4" />}
            action={
              <Button
                type="button"
                size="sm"
                onClick={handleComplete}
                disabled={locked || blockers.length > 0 || pending !== null}
              >
                <Check className="h-4 w-4" />
                Complete
              </Button>
            }
          >
            {blockers.length === 0 ? (
              <div className="rounded-md border border-status-green/20 bg-status-green-soft px-3 py-2 text-sm text-status-green">
                Required evidence, payment, and filing proof are ready.
              </div>
            ) : (
              <ul className="space-y-2">
                {blockers.map((blocker) => (
                  <li
                    key={blocker.code}
                    className="flex items-start gap-2 rounded-md border border-status-orange/20 bg-status-orange-soft px-3 py-2 text-sm text-status-orange"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{blocker.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Checklist" icon={<ClipboardList className="h-4 w-4" />}>
            <ul className="divide-y divide-border">
              {c.checklist.map((item) => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  disabled={locked || pending !== null}
                  pending={pending}
                  onChange={handleChecklistStatus}
                />
              ))}
            </ul>
          </Panel>

          <PaymentPanel
            payment={c.payment}
            disabled={locked || pending !== null}
            pending={pending}
            onChange={handlePaymentStatus}
          />

          <Panel
            title="Filing Proof"
            icon={<Upload className="h-4 w-4" />}
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locked || pending !== null}
                onClick={handleFilingProof}
              >
                <Upload className="h-4 w-4" />
                Record
              </Button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Filing reference" value={c.filingReference ?? "Missing"} />
              <Fact
                label="Confirmation document"
                value={c.confirmationDocumentId ? shortId(c.confirmationDocumentId) : "Missing"}
                mono={Boolean(c.confirmationDocumentId)}
              />
            </div>
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel
            title="Reminder"
            icon={<Bell className="h-4 w-4" />}
            action={
              <Button
                type="button"
                size="sm"
                disabled={locked || pending !== null}
                onClick={handleReminder}
              >
                <Bell className="h-4 w-4" />
                Record sent
              </Button>
            }
          >
            <div className="space-y-3">
              <Metric label="Manual reminders" value={c.remindersSent.toString()} />
            </div>
          </Panel>

          <Panel title="Case Facts" icon={<FileText className="h-4 w-4" />}>
            <div className="space-y-3">
              <Fact label="Case ID" value={c.id} mono />
              <Fact label="Company ID" value={c.companyId} mono />
              <Fact label="Made-up date" value={formatDateOnly(c.madeUpDate)} />
              <Fact label="Filing due date" value={formatDateOnly(c.filingDueDate)} />
              <Fact label="Owner" value={c.ownerName} />
              <Fact label="Reviewer" value={c.reviewerName ?? "Unassigned"} />
              <Fact
                label="Completed"
                value={c.completedAt ? formatDateOnly(c.completedAt) : "Not completed"}
              />
            </div>
          </Panel>
        </aside>
      </main>
    </>
  );
}

function ChecklistRow({
  item,
  disabled,
  pending,
  onChange,
}: {
  item: AnnualReturnChecklistItem;
  disabled: boolean;
  pending: ActionKey | null;
  onChange: (item: AnnualReturnChecklistItem, status: ChecklistStatus) => void;
}) {
  const verifyPending = pending === `checklist-${item.id}-Verified`;
  const receivedPending = pending === `checklist-${item.id}-Received`;
  const missingPending = pending === `checklist-${item.id}-Missing`;

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{item.itemLabel}</p>
          {item.required && <span className="text-[11px] text-muted-foreground">Required</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <DeadlinePill dueDate={item.dueDate} showDate />
          {item.documentId && <span className="font-mono">Doc {shortId(item.documentId)}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <StatusPill tone={checklistTone(item.status)}>{item.status}</StatusPill>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || item.status === "Received" || item.status === "Verified"}
          onClick={() => onChange(item, "Received")}
        >
          <Receipt className="h-4 w-4" />
          {receivedPending ? "Saving" : "Received"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || item.status === "Verified"}
          onClick={() => onChange(item, "Verified")}
        >
          <Check className="h-4 w-4" />
          {verifyPending ? "Saving" : "Verify"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || item.status === "Missing"}
          onClick={() => onChange(item, "Missing")}
        >
          {missingPending ? "Saving" : "Reset"}
        </Button>
      </div>
    </li>
  );
}

function PaymentPanel({
  payment,
  disabled,
  pending,
  onChange,
}: {
  payment: AnnualReturnCase["payment"];
  disabled: boolean;
  pending: ActionKey | null;
  onChange: (status: PaymentStatus) => void;
}) {
  if (!payment) {
    return (
      <Panel title="Payment" icon={<Receipt className="h-4 w-4" />}>
        <div className="text-sm text-muted-foreground">No payment record.</div>
      </Panel>
    );
  }

  return (
    <Panel title="Payment" icon={<Receipt className="h-4 w-4" />}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Status"
          value={<StatusPill tone={paymentTone(payment.status)}>{payment.status}</StatusPill>}
        />
        <Metric label="Invoice" value={payment.invoiceNumber} />
        <Metric
          label="Amount"
          value={`${payment.currency} ${payment.amount.toLocaleString("en-HK")}`}
        />
        <Metric label="Due" value={<DeadlinePill dueDate={payment.dueDate} showDate />} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || payment.status === "Payment pending"}
          onClick={() => onChange("Payment pending")}
        >
          {pending === "payment-pending" ? "Saving" : "Mark pending"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || payment.status === "Overdue"}
          onClick={() => onChange("Overdue")}
        >
          {pending === "payment-overdue" ? "Saving" : "Mark overdue"}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled || payment.status === "Payment received"}
          onClick={() => onChange("Payment received")}
        >
          <Check className="h-4 w-4" />
          {pending === "payment-received" ? "Saving" : "Mark received"}
        </Button>
      </div>
      <div className="mt-3">
        <Fact
          label="Payment proof"
          value={
            payment.paymentProofDocumentId ? shortId(payment.paymentProofDocumentId) : "Missing"
          }
          mono={Boolean(payment.paymentProofDocumentId)}
        />
      </div>
    </Panel>
  );
}

function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="truncate font-display text-base font-semibold text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 truncate text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div
        className={cn(
          "mt-1 truncate text-sm font-medium text-foreground",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function RiskPill({ risk }: { risk: RiskLevel }) {
  return (
    <StatusPill tone={riskTone(risk)} className="shrink-0 whitespace-nowrap capitalize">
      {risk} risk
    </StatusPill>
  );
}

async function copyDraftToClipboard(draftBody: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(draftBody);
  } catch {
    // Recording the reminder should not depend on browser clipboard permissions.
  }
}

function promptRequired(label: string, defaultValue = ""): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.prompt(label, defaultValue);

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatDateOnly(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  const monthLabel = MONTH_LABELS[Number(month) - 1] ?? month;

  return `${day} ${monthLabel} ${year}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function isLocked(case_: AnnualReturnCase): boolean {
  return (
    case_.currentStatus === "Completed" || case_.lockedAt !== null || case_.completedAt !== null
  );
}

function annualReturnStatusTone(status: AnnualReturnStatus): StatusTone {
  switch (status) {
    case "Upcoming":
    case "Filed":
    case "Completed":
      return "blue";
    case "Client reminder sent":
    case "Documents received":
    case "Payment received":
    case "NAR1 prepared":
    case "Ready to file":
      return "green";
    case "Documents pending":
    case "Signature pending":
      return "yellow";
    case "Payment pending":
      return "orange";
    default:
      return "neutral";
  }
}

function checklistTone(status: ChecklistStatus): StatusTone {
  switch (status) {
    case "Verified":
      return "green";
    case "Received":
      return "blue";
    case "Rejected":
      return "red";
    case "Missing":
      return "yellow";
  }
}

function paymentTone(status: PaymentStatus): StatusTone {
  switch (status) {
    case "Payment received":
      return "green";
    case "Payment pending":
      return "orange";
    case "Overdue":
      return "red";
    case "Not invoiced":
      return "neutral";
  }
}

function riskTone(risk: RiskLevel): StatusTone {
  switch (risk) {
    case "red":
      return "red";
    case "orange":
      return "orange";
    case "yellow":
      return "yellow";
    case "green":
      return "green";
  }
}
