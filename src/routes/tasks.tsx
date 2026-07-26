import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import {
  type AnnualReturnRiskLevel,
  getCaseTasks,
  useAnnualReturnCases,
} from "../lib/annual-return-store";

export const Route = createFileRoute("/tasks")({
  component: TasksRoute,
});

const riskLabels: Record<AnnualReturnRiskLevel, string> = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  blocked: "Blocked",
  healthy: "Healthy",
  "ready-to-file": "Ready to file",
  filed: "Filed",
};

function TasksRoute() {
  const cases = useAnnualReturnCases();
  const tasks = cases.flatMap((caseItem) => getCaseTasks(caseItem));

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title="Tasks" />
      <div className="rounded-lg border bg-card">
        {tasks.length ? (
          tasks.map((task) => (
            <div
              key={task.id}
              className="grid gap-2 border-b p-4 text-sm last:border-b-0 md:grid-cols-[1fr_180px_140px]"
            >
              <div>
                <p className="font-medium">{task.title}</p>
                <p className="text-muted-foreground">{task.companyName}</p>
              </div>
              <span>{task.owner}</span>
              <span>{riskLabels[task.riskLevel]}</span>
            </div>
          ))
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No open tasks.</p>
        )}
      </div>
    </main>
  );
}
