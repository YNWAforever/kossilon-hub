import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { DeadlinePill } from "@/components/deadline-pill";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { listAnnualReturnCases } from "@/features/annual-return/server-fns";
import {
  ANNUAL_RETURN_STATUSES,
  type AnnualReturnCase,
  type AnnualReturnStatus,
  type PaymentStatus,
  type RiskLevel,
} from "@/features/annual-return/types";
import { toneClasses, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

type RiskFilter = RiskLevel | "all";
type StatusFilter = AnnualReturnStatus | "all";
type ViewMode = "deadline" | "board";

export const Route = createFileRoute("/annual-returns")({
  loader: () => listAnnualReturnCases({ data: {} }),
  head: () => ({
    meta: [
      { title: "Annual Returns Board — Kossilon CoSec OS" },
      {
        name: "description",
        content:
          "Deadline-first annual return control center with risk filters and status board view.",
      },
    ],
  }),
  component: AnnualReturnsPage,
});

function AnnualReturnsPage() {
  const cases = Route.useLoaderData() as AnnualReturnCase[];
  const [view, setView] = useState<ViewMode>("deadline");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filteredCases = useMemo(
    () =>
      cases
        .filter((case_) => {
          const riskMatch = risk === "all" || case_.riskLevel === risk;
          const statusMatch = status === "all" || case_.currentStatus === status;

          return riskMatch && statusMatch;
        })
        .sort(
          (a, b) =>
            a.filingDueDate.localeCompare(b.filingDueDate) ||
            a.companyName.localeCompare(b.companyName),
        ),
    [cases, risk, status],
  );

  return (
    <>
      <TopBar
        title="Annual Return Control Center"
        subtitle={`${filteredCases.length} of ${cases.length} cases sorted by statutory deadline`}
      />
      <main className="flex-1 space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter annual return cases by risk"
              value={risk}
              onChange={(event) => setRisk(event.target.value as RiskFilter)}
              className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All risks</option>
              <option value="red">Red risk</option>
              <option value="orange">Orange risk</option>
              <option value="yellow">Yellow risk</option>
              <option value="green">Green risk</option>
            </select>
            <select
              aria-label="Filter annual return cases by status"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All statuses</option>
              {ANNUAL_RETURN_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex rounded-md border border-border bg-card p-1">
            <Button
              type="button"
              size="sm"
              variant={view === "deadline" ? "default" : "ghost"}
              aria-pressed={view === "deadline"}
              onClick={() => setView("deadline")}
            >
              Deadline list
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "board" ? "default" : "ghost"}
              aria-pressed={view === "board"}
              onClick={() => setView("board")}
            >
              Status board
            </Button>
          </div>
        </div>

        {view === "deadline" ? (
          <DeadlineList cases={filteredCases} />
        ) : (
          <StatusBoard cases={filteredCases} />
        )}
      </main>
    </>
  );
}

function DeadlineList({ cases }: { cases: AnnualReturnCase[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-[260px] px-5 py-3 font-medium">Company</th>
              <th className="w-[170px] px-5 py-3 font-medium">Deadline</th>
              <th className="w-[120px] px-5 py-3 font-medium">Risk</th>
              <th className="w-[190px] px-5 py-3 font-medium">Status</th>
              <th className="w-[120px] px-5 py-3 font-medium">Missing</th>
              <th className="w-[170px] px-5 py-3 font-medium">Payment</th>
              <th className="w-[150px] px-5 py-3 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cases.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No annual return cases match the current filters.
                </td>
              </tr>
            ) : (
              cases.map((case_) => (
                <tr key={case_.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <Link
                      to="/annual-returns/$id"
                      params={{ id: case_.id }}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {case_.companyName}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Return year {case_.returnYear}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <DeadlinePill dueDate={case_.filingDueDate} showDate />
                  </td>
                  <td className="px-5 py-3">
                    <RiskPill risk={case_.riskLevel} />
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill
                      tone={annualReturnStatusTone(case_.currentStatus)}
                      className="whitespace-nowrap"
                    >
                      {case_.currentStatus}
                    </StatusPill>
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-medium tabular-nums text-foreground">
                      {missingRequiredEvidenceCount(case_)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <PaymentPill status={case_.payment?.status ?? "Not invoiced"} />
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    <span className="block max-w-[140px] truncate">{case_.ownerName}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBoard({ cases }: { cases: AnnualReturnCase[] }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-4">
        {ANNUAL_RETURN_STATUSES.map((status) => {
          const items = cases.filter((case_) => case_.currentStatus === status);
          const tone = annualReturnStatusTone(status);
          const t = toneClasses[tone];

          return (
            <section key={status} className="w-72 shrink-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", t.dot)} />
                  <h2 className="truncate text-sm font-semibold text-foreground">{status}</h2>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    No cases
                  </div>
                ) : (
                  items.map((case_) => <BoardCaseCard key={case_.id} case_={case_} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCaseCard({ case_ }: { case_: AnnualReturnCase }) {
  return (
    <Link
      to="/annual-returns/$id"
      params={{ id: case_.id }}
      className="block rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{case_.companyName}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Owner: {case_.ownerName}</p>
        </div>
        <RiskPill risk={case_.riskLevel} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <DeadlinePill dueDate={case_.filingDueDate} />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {missingRequiredEvidenceCount(case_)} missing
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <StatusPill
          tone={annualReturnStatusTone(case_.currentStatus)}
          className="max-w-[150px] truncate whitespace-nowrap !py-0.5 !text-[10px]"
        >
          {case_.currentStatus}
        </StatusPill>
        <PaymentPill status={case_.payment?.status ?? "Not invoiced"} compact />
      </div>
    </Link>
  );
}

function RiskPill({ risk }: { risk: RiskLevel }) {
  return (
    <StatusPill tone={riskTone(risk)} className="shrink-0 whitespace-nowrap capitalize">
      {risk} risk
    </StatusPill>
  );
}

function PaymentPill({ status, compact = false }: { status: PaymentStatus; compact?: boolean }) {
  return (
    <StatusPill
      tone={paymentTone(status)}
      className={cn("whitespace-nowrap", compact && "max-w-[110px] truncate !py-0.5 !text-[10px]")}
    >
      {status}
    </StatusPill>
  );
}

function missingRequiredEvidenceCount(case_: AnnualReturnCase) {
  return case_.checklist.filter((item) => item.required && !hasRequiredEvidence(item)).length;
}

function hasRequiredEvidence(item: AnnualReturnCase["checklist"][number]) {
  return (
    item.status === "Verified" &&
    hasText(item.receivedAt) &&
    hasText(item.verifiedAt) &&
    hasText(item.documentId)
  );
}

function hasText(value: string | null) {
  return typeof value === "string" && value.trim().length > 0;
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
