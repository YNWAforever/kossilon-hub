import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/teams")({
  component: () => (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">People</p>
        <h1 className="mt-1 text-3xl font-semibold">Teams</h1>
      </div>
      <section className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        Staff assignment and workload views are ready for the next workflow phase.
      </section>
    </div>
  ),
});
