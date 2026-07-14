import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { daysUntil, findEnquiryForClient } from "@/lib/app-data";
import {
  type AnnualReturnCase,
  type AnnualReturnFollowUpDraft,
  type AnnualReturnPacketStatus,
  type AnnualReturnPaymentStatus,
  type AnnualReturnReviewStatus,
  type AnnualReturnRiskLevel,
  type AnnualReturnSignatureStatus,
  type AnnualReturnStatus,
  canSendFollowUp,
  getBlockers,
  getFollowUpDrafts,
  getNextAction,
  getPacketReadiness,
  getPacketStatus,
  getReadinessScore,
  getRiskLevel,
  useAnnualReturnCase,
} from "@/lib/annual-return-store";
import {
  getClientPortalActivity,
  getClientPortalRequiredActions,
  getDocumentArchiveRows,
  useClientPortalSnapshot,
} from "@/lib/client-portal-store";
import { listWorkQueue } from "@/features/work-items/server-fns";

const ownerOptions = ["Iris Wong", "Calvin Ho", "Mandy Lee", "Operations"] as const;
type MetricTone = "red" | "orange" | "yellow" | "green" | "blue";

const statusLabels: Record<AnnualReturnStatus, string> = {
  preparing: "Preparing",
  "waiting-documents": "Waiting documents",
  "payment-pending": "Payment pending",
  "internal-review": "Internal review",
  "ready-to-file": "Ready to file",
  filed: "Filed",
};

const riskLabels: Record<AnnualReturnRiskLevel, string> = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  blocked: "Blocked",
  healthy: "Healthy",
  "ready-to-file": "Ready",
  filed: "Filed",
};

const metricToneClasses: Record<MetricTone, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
};

const riskToneClasses: Record<AnnualReturnRiskLevel, string> = {
  overdue: "bg-red-100 text-red-700",
  "due-soon": "bg-orange-100 text-orange-700",
  blocked: "bg-yellow-100 text-yellow-800",
  healthy: "bg-slate-100 text-slate-700",
  "ready-to-file": "bg-green-100 text-green-700",
  filed: "bg-blue-100 text-blue-700",
};

export function DemoAnnualReturnCaseDetail({ caseId }: { caseId: string }) {
  const id = caseId;
  const caseItem = useAnnualReturnCase(id);
  const workItemsQuery = useQuery({
    queryKey: ["work-queue", "annual-return-detail", id],
    queryFn: () => listWorkQueue({ data: { view: "team" } }),
  });
  const workItem = (workItemsQuery.data ?? []).find((item) => item.caseId === id);
  const portalSnapshot = useClientPortalSnapshot();
  const [note, setNote] = useState("");
  const [packetWarning, setPacketWarning] = useState<string | undefined>();
  const [followUpWarning, setFollowUpWarning] = useState<string | undefined>();

  useEffect(() => {
    setNote("");
    setPacketWarning(undefined);
    setFollowUpWarning(undefined);
  }, [id]);

  if (!caseItem) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Case not found</h1>
        <p className="text-sm text-muted-foreground">
          This annual return case does not exist in the mocked workspace.
        </p>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          Back to command center
        </Link>
      </div>
    );
  }

  const enquiry = findEnquiryForClient(caseItem.clientId);
  const risk = getRiskLevel(caseItem);
  const readiness = getReadinessScore(caseItem);
  const blockers = getBlockers(caseItem);
  const nextAction = getNextAction(caseItem);
  const dueInDays = daysUntil(caseItem.dueDate);
  const isFiled = caseItem.status === "filed";
  const packetReadiness = getPacketReadiness(caseItem);
  const packetStatus = getPacketStatus(caseItem);
  const packetLocked = isFiled || Boolean(caseItem.submission);
  const followUps = getFollowUpDrafts(caseItem);
  const portalActions = getClientPortalRequiredActions(caseItem, portalSnapshot);
  const portalActivity = getClientPortalActivity(caseItem.id, portalSnapshot);
  const archiveRows = getDocumentArchiveRows([caseItem], portalSnapshot);
  const latestPortalActivity = portalActivity[0];

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          Back
        </Link>
        <div className="flex items-center gap-2">
          <Link
            className="rounded-md border px-3 py-2 text-sm"
            to="/work-queue"
            search={{
              view: "team",
              owner: "all",
              workType: "all",
              sla: "all",
              priority: "all",
              status: "all",
            }}
          >
            Assignment &amp; SLA
          </Link>
          {enquiry ? (
            <Link
              className="rounded-md border px-3 py-2 text-sm"
              to="/whatsapp"
              search={{ enquiry: enquiry.id }}
            >
              Ask AI
            </Link>
          ) : null}
        </div>
      </div>

      <section className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Annual return case</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">{caseItem.companyName}</h1>
                <RiskPill risk={risk} />
                <span className="inline-flex rounded-md bg-muted px-2 py-1 text-xs font-medium">
                  {statusLabel(caseItem.status)}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {caseItem.contactName} / {caseItem.phone} / Basis date {caseItem.basisDate}
              </p>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">Work owner:</span>{" "}
                  {workItemsQuery.isPending
                    ? "Loading"
                    : workItemsQuery.isError
                      ? "Unavailable"
                      : workItem?.ownerId
                        ? `Staff ${workItem.ownerId.slice(0, 8)}`
                        : workItem
                          ? "Unassigned"
                          : "No work item"}
                </p>
                <p>
                  <span className="text-muted-foreground">SLA state:</span>{" "}
                  {workItemsQuery.isPending
                    ? "Loading"
                    : workItemsQuery.isError
                      ? "Unavailable"
                      : workItem
                        ? workItem.escalationState
                        : "No work item"}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DenseStat
                label="Due"
                value={formatDue(caseItem.dueDate, dueInDays)}
                tone={dueInDays < 0 ? "red" : dueInDays <= 14 ? "orange" : "blue"}
              />
              <DenseStat
                label="Readiness"
                value={`${readiness}%`}
                tone={readiness === 100 ? "green" : readiness >= 60 ? "blue" : "yellow"}
              />
              <DenseStat
                label="Next action"
                value={nextAction}
                tone={
                  blockers.length > 0 ? "yellow" : caseItem.status === "filed" ? "blue" : "green"
                }
              />
              <DenseStat
                label="Blockers"
                value={blockers.length === 0 ? "None" : `${blockers.length} open`}
                tone={blockers.length === 0 ? "green" : "yellow"}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:min-w-72">
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Owner
              </span>
              <select
                aria-label="Assign owner"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                disabled={isFiled}
                value={caseItem.owner}
                onChange={() =>
                  setPacketWarning("Production owner actions are handled by the work queue.")
                }
              >
                {ownerOptions.map((owner) => (
                  <option key={owner} value={owner}>
                    {owner}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Blockers</h2>
                <p className="text-sm text-muted-foreground">
                  Clear document, payment, signature, and review blockers to raise readiness.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">{blockers.length} open</span>
            </div>

            <div className="mt-4 divide-y">
              {caseItem.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0"
                >
                  <div>
                    <p className="font-medium">{doc.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {doc.received ? "Received" : "Missing"}
                    </p>
                  </div>
                  <button
                    className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                    disabled={isFiled}
                    onClick={() =>
                      setPacketWarning(
                        "Production document state is managed by the private document workflow.",
                      )
                    }
                    type="button"
                  >
                    {doc.received ? "Mark missing" : "Mark received"}
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Payment
                </span>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled={isFiled}
                  value={caseItem.paymentStatus}
                  onChange={() =>
                    setPacketWarning(
                      "Production payment state is managed by the annual-return server action.",
                    )
                  }
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Signature
                </span>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled={isFiled}
                  value={caseItem.signatureStatus}
                  onChange={() =>
                    setPacketWarning(
                      "Production signature state is managed by the annual-return server action.",
                    )
                  }
                >
                  <option value="missing">Missing</option>
                  <option value="requested">Requested</option>
                  <option value="received">Received</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Review
                </span>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled={isFiled}
                  value={caseItem.reviewStatus}
                  onChange={() =>
                    setPacketWarning(
                      "Production review state is managed by the annual-return server action.",
                    )
                  }
                >
                  <option value="not-started">Not started</option>
                  <option value="in-review">In review</option>
                  <option value="approved">Approved</option>
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Filing packet</h2>
                <p className="text-sm text-muted-foreground">
                  Assemble the mocked NAR1 packet before submission.
                </p>
              </div>
              <div className="text-right">
                <span
                  className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${packetToneClass(packetStatus)}`}
                >
                  {packetStatusLabel(packetStatus)}
                </span>
                <p className="mt-1 text-sm text-muted-foreground">
                  {packetReadiness}% packet ready
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {caseItem.packetRequirements.map((requirement) => (
                <button
                  key={requirement.id}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled={packetLocked}
                  onClick={() =>
                    setPacketWarning(
                      "Production packet state is managed by the annual-return server action.",
                    )
                  }
                  type="button"
                >
                  <span>{requirement.label}</span>
                  <span>{requirement.complete ? "Complete" : "Open"}</span>
                </button>
              ))}
            </div>

            {caseItem.submission ? (
              <div className="mt-4 rounded-md border bg-background px-3 py-3 text-sm">
                <p className="font-medium">Submitted reference</p>
                <p className="text-muted-foreground">{caseItem.submission.reference}</p>
              </div>
            ) : null}

            {caseItem.receipt ? (
              <div className="mt-3 rounded-md border bg-background px-3 py-3 text-sm">
                <p className="font-medium">Receipt accepted</p>
                <p className="text-muted-foreground">{caseItem.receipt.receiptNumber}</p>
              </div>
            ) : null}

            {packetWarning ? (
              <div className="mt-4 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
                {packetWarning}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                disabled={isFiled || Boolean(caseItem.submission)}
                onClick={() =>
                  setPacketWarning(
                    "Production packet submission is handled by the annual-return server action.",
                  )
                }
                type="button"
              >
                Submit packet
              </button>
              <button
                className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                disabled={isFiled || !caseItem.submission || Boolean(caseItem.receipt)}
                onClick={() =>
                  setPacketWarning(
                    "Production receipt acceptance is handled by the annual-return server action.",
                  )
                }
                type="button"
              >
                Accept receipt
              </button>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Follow-ups</h2>
                <p className="text-sm text-muted-foreground">
                  Mock WhatsApp reminders generated from current blockers.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">
                {followUps.filter((draft) => draft.status === "draft").length} open
              </span>
            </div>

            {followUpWarning ? (
              <div className="mt-4 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
                {followUpWarning}
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              {followUps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No follow-ups are needed.</p>
              ) : (
                followUps.map((draft) => (
                  <FollowUpCard
                    key={draft.id}
                    caseItem={caseItem}
                    draft={draft}
                    onSend={() =>
                      setFollowUpWarning(
                        "Production follow-ups are dispatched by the notification outbox.",
                      )
                    }
                  />
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Checklist</h2>
                <p className="text-sm text-muted-foreground">
                  Toggle each operator task as work moves forward or reopens.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">
                {caseItem.checklist.filter((item) => item.complete).length}/
                {caseItem.checklist.length}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {caseItem.checklist.map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled={isFiled}
                  onClick={() =>
                    item.complete
                      ? setPacketWarning(
                          "Production checklist state is managed by the annual-return server action.",
                        )
                      : setPacketWarning(
                          "Production checklist state is managed by the annual-return server action.",
                        )
                  }
                  type="button"
                >
                  <span>{item.label}</span>
                  <span>{item.complete ? "Complete" : "Open"}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Notes</h2>
                <p className="text-sm text-muted-foreground">
                  Capture operator context without leaving the case.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">{caseItem.notes.length} notes</span>
            </div>

            <div className="mt-4 space-y-3">
              <textarea
                aria-readonly={isFiled}
                className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm read-only:cursor-not-allowed read-only:bg-muted read-only:text-muted-foreground"
                readOnly={isFiled}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="flex justify-end">
                <button
                  className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled={isFiled || !note.trim()}
                  onClick={() => {
                    if (!note.trim()) return;
                    setPacketWarning(
                      "Production notes are managed by the annual-return server action.",
                    );
                  }}
                  type="button"
                >
                  Add note
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {caseItem.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                caseItem.notes.map((entry) => (
                  <div key={entry.id} className="rounded-md border px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{entry.author}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimestamp(entry.createdAt)}
                      </p>
                    </div>
                    <p className="mt-2 text-sm">{entry.body}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Client portal activity</h2>
                <p className="text-sm text-muted-foreground">
                  Client-facing actions and archive records for this case.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">
                {portalActions.filter((action) => action.status === "open").length} open
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <DenseStat
                label="Outstanding"
                value={`${portalActions.filter((action) => action.status === "open").length}`}
                tone={portalActions.some((action) => action.status === "open") ? "yellow" : "green"}
              />
              <DenseStat label="Archive" value={`${archiveRows.length}`} tone="blue" />
              <DenseStat
                label="Latest"
                value={
                  latestPortalActivity ? formatTimestamp(latestPortalActivity.createdAt) : "None"
                }
                tone={latestPortalActivity ? "green" : "blue"}
              />
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Link
                className="rounded-md border px-3 py-2 text-sm"
                to="/documents"
                search={{ caseId: caseItem.id }}
              >
                Open archive
              </Link>
              <Link
                className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                to="/portal"
                search={{ caseId: caseItem.id }}
              >
                Open portal
              </Link>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Timeline</h2>
                <p className="text-sm text-muted-foreground">Newest case activity appears first.</p>
              </div>
              <span className="text-sm text-muted-foreground">
                {caseItem.timeline.length} events
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {caseItem.timeline.map((event) => (
                <div key={event.id} className="rounded-md border px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{event.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTimestamp(event.createdAt)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{event.detail}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function DenseStat({ label, value, tone }: { label: string; value: string; tone: MetricTone }) {
  return (
    <div className="rounded-md border bg-background px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${metricToneClass(tone)}`} />
      </div>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}

function RiskPill({ risk }: { risk: AnnualReturnRiskLevel }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${riskToneClass(risk)}`}>
      {riskLabel(risk)}
    </span>
  );
}

function formatDue(dueDate: string, dueInDays: number): string {
  if (dueInDays < 0) {
    return `${dueDate} (${Math.abs(dueInDays)}d overdue)`;
  }

  return `${dueDate} (${dueInDays}d)`;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-HK", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: AnnualReturnStatus): string {
  return statusLabels[status];
}

function riskLabel(risk: AnnualReturnRiskLevel): string {
  return riskLabels[risk];
}

function metricToneClass(tone: MetricTone): string {
  return metricToneClasses[tone];
}

function riskToneClass(risk: AnnualReturnRiskLevel): string {
  return riskToneClasses[risk];
}

function FollowUpCard({
  caseItem,
  draft,
  onSend,
}: {
  caseItem: AnnualReturnCase;
  draft: AnnualReturnFollowUpDraft;
  onSend: () => void;
}) {
  const eligibility = canSendFollowUp(caseItem, draft);
  const disabled = !eligibility.ok;

  return (
    <div className="rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{followUpTypeLabel(draft.type)}</p>
          <p className="text-sm text-muted-foreground">
            {draft.recipientName} / {draft.phone} / {draft.suggestedTiming}
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{draft.status}</span>
      </div>
      <p className="mt-3 text-sm">{draft.messagePreview}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {disabled ? eligibility.reason : "Ready to mock-send"}
        </p>
        <button
          className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          disabled={disabled}
          onClick={onSend}
          type="button"
        >
          Send now
        </button>
      </div>
    </div>
  );
}

function followUpTypeLabel(type: AnnualReturnFollowUpDraft["type"]): string {
  return {
    "missing-document": "Missing document request",
    "payment-reminder": "Payment reminder",
    "signature-nudge": "Signature nudge",
    "review-escalation": "Review escalation",
    "packet-reminder": "Packet reminder",
  }[type];
}

function packetStatusLabel(status: AnnualReturnPacketStatus): string {
  return {
    "not-started": "Not started",
    building: "Building",
    "ready-for-review": "Ready for review",
    approved: "Approved",
    submitted: "Submitted",
    accepted: "Accepted",
  }[status];
}

function packetToneClass(status: AnnualReturnPacketStatus): string {
  return {
    "not-started": "bg-slate-100 text-slate-700",
    building: "bg-yellow-100 text-yellow-800",
    "ready-for-review": "bg-orange-100 text-orange-700",
    approved: "bg-green-100 text-green-700",
    submitted: "bg-blue-100 text-blue-700",
    accepted: "bg-blue-100 text-blue-700",
  }[status];
}
