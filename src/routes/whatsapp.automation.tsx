import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/whatsapp/automation")({
  component: () => (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">WhatsApp</p>
        <h1 className="mt-1 text-3xl font-semibold">Automation</h1>
      </div>
      <section className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        Automation rules are not part of this phase; AI drafting is available in the inbox.
      </section>
    </div>
  ),
});
