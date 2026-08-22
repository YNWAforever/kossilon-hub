import { PageHeader } from "@/components/page-header";

type Props = {
  variant: "list" | "detail";
};

const COPY: Record<Props["variant"], { title: string; message: string }> = {
  list: {
    title: "Incorporation",
    message:
      "Incorporation intake tracks live case data and has no demo fixtures. Sign in to a production environment to use it.",
  },
  detail: {
    title: "Incorporation case",
    message:
      "Incorporation case detail reads live case data and has no demo fixtures. Sign in to a production environment to view one.",
  },
};

export function DemoIncorporationNotice({ variant }: Props) {
  const copy = COPY[variant];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title={copy.title} />
      <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        {copy.message}
      </section>
    </main>
  );
}
