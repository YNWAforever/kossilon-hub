import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { StatusTone } from "@/lib/status";
import { toneClasses } from "@/lib/status";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: StatusTone;
}) {
  const t = toneClasses[tone];
  return (
    <div className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", t.bg)}>
          <Icon className={cn("h-4 w-4", t.text)} />
        </div>
      </div>
      <div className="mt-4">
        <p className="font-display text-3xl font-semibold tabular-nums text-foreground">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
