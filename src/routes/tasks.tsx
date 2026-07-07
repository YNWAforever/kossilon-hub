import { createFileRoute } from "@tanstack/react-router";

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
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Work queue</p>
        <h1 className="mt-1 text-3xl font-semibold">Tasks</h1>
      </div>
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
    </div>
  );
}
