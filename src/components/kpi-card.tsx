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
  unavailable = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: StatusTone;
  // When the figure could not be measured, render an em dash rather than the
  // caller's fallback. A zero in this typography reads as a measurement.
  unavailable?: boolean;
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
        <p
          data-testid="kpi-value"
          aria-label={unavailable ? `${label}: unavailable` : undefined}
          className={cn(
            "font-display text-3xl font-semibold tabular-nums",
            unavailable ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {unavailable ? "—" : value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{unavailable ? "Unavailable" : hint}</p>
      </div>
    </div>
  );
}
