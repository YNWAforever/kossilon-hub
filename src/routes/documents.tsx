import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/documents")({
  component: () => (
    <SimplePage title="Documents" subtitle="Uploaded registry and client files will appear here." />
  ),
});

function SimplePage({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Workspace</p>
        <h1 className="mt-1 text-3xl font-semibold">{title}</h1>
      </div>
      <section className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        {subtitle}
      </section>
    </div>
  );
}
