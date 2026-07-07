import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { tasks, teamMembers, currentUser } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — Kossilon CoSec OS" },
      {
        name: "description",
        content:
          "Personal and team task list — chase documents, prepare filings, follow up payments.",
      },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  const mine = tasks.filter((t) => t.assigneeId === currentUser.id);
  const others = tasks.filter((t) => t.assigneeId !== currentUser.id);

  return (
    <>
      <TopBar
        title="Tasks"
        subtitle={`${mine.filter((t) => !t.done).length} open · ${others.length} across team`}
      />
      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-2">
        {[
          { label: "My tasks", list: mine },
          { label: "Team tasks", list: others },
        ].map((group) => (
          <div key={group.label} className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">
                {group.label}
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {group.list.map((t) => {
                const assignee = teamMembers.find((m) => m.id === t.assigneeId)!;
                return (
                  <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                    <input
                      type="checkbox"
                      defaultChecked={t.done}
                      className="mt-1 h-4 w-4 rounded border-border"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          t.done ? "text-muted-foreground line-through" : "text-foreground",
                        )}
                      >
                        {t.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t.companyName} · {assignee.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill
                        tone={
                          t.priority === "High"
                            ? "red"
                            : t.priority === "Normal"
                              ? "yellow"
                              : "neutral"
                        }
                      >
                        {t.priority}
                      </StatusPill>
                      <DeadlinePill dueDate={t.dueDate} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </main>
    </>
  );
}
