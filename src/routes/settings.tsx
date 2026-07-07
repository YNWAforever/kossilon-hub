import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeBaseSection } from "../components/knowledge-base-section";
import { checklistTemplates } from "../lib/app-data";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  return (
    <div className="space-y-8 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Settings</p>
        <h1 className="mt-1 text-3xl font-semibold">Operating templates</h1>
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-lg font-semibold">Checklist templates</h2>
          <p className="text-sm text-muted-foreground">
            Shared steps used by case workflows and AI context.
          </p>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-3">
          {checklistTemplates.map((template) => (
            <article key={template.id} className="rounded-lg border bg-background p-4">
              <h3 className="font-semibold">{template.name}</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {template.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <KnowledgeBaseSection />
    </div>
  );
}
