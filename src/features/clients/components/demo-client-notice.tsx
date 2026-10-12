import { DemoUnavailable } from "@/components/demo-unavailable";
import { PageHeader } from "@/components/page-header";

type Props = {
  variant: "register" | "detail";
};

const COPY: Record<Props["variant"], { title: string; message: string }> = {
  register: {
    title: "Clients",
    message:
      "The client register reads live company records and has no demo fixtures. Sign in to a production environment to use it.",
  },
  detail: {
    title: "Client",
    message:
      "Client profiles read live company records and have no demo fixtures. Sign in to a production environment to view one.",
  },
};

export function DemoClientNotice({ variant }: Props) {
  const copy = COPY[variant];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title={copy.title} />
      <DemoUnavailable message={copy.message} />
    </main>
  );
}
