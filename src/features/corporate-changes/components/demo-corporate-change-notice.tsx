import { DemoUnavailable } from "@/components/demo-unavailable";
import { PageHeader } from "@/components/page-header";

type Props = {
  variant: "list" | "detail";
};

const COPY: Record<Props["variant"], { title: string; message: string }> = {
  list: {
    title: "Corporate changes",
    message:
      "Corporate change requests track live case data and have no demo fixtures. Sign in to a production environment to use them.",
  },
  detail: {
    title: "Corporate change request",
    message:
      "Corporate change request detail reads live case data and has no demo fixtures. Sign in to a production environment to view one.",
  },
};

export function DemoCorporateChangeNotice({ variant }: Props) {
  const copy = COPY[variant];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title={copy.title} />
      <DemoUnavailable message={copy.message} />
    </main>
  );
}
