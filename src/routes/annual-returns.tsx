import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { CaseCard } from "@/components/case-card";
import { CASE_STATUSES, cases } from "@/lib/mock-data";
import { caseStatusTone, toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/annual-returns")({
  head: () => ({
    meta: [
      { title: "Annual Returns Board — Kossilon CoSec OS" },
      { name: "description", content: "Kanban board of annual return cases across 11 statuses from Upcoming to Completed." },
    ],
  }),
  component: AnnualReturnsPage,
});

function AnnualReturnsPage() {
  return (
    <>
      <TopBar title="Annual Return Board" subtitle={`${cases.length} cases across ${CASE_STATUSES.length} statuses`} />
      <main className="flex-1 overflow-x-auto p-6">
        <div className="flex min-w-max gap-4">
          {CASE_STATUSES.map((status) => {
            const items = cases.filter((c) => c.status === status);
            const tone = caseStatusTone(status);
            const t = toneClasses[tone];
            return (
              <div key={status} className="w-72 shrink-0">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", t.dot)} />
                    <h2 className="text-sm font-semibold text-foreground">{status}</h2>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">No cases</div>
                  ) : items.map((c) => <CaseCard key={c.id} c={c} />)}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
