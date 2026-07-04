import { cn } from "@/lib/utils";
import { deadlineTone, formatDaysLeft, toneClasses } from "@/lib/status";
import { daysUntil, formatDate } from "@/lib/mock-data";

export function DeadlinePill({ dueDate, showDate = false }: { dueDate: string; showDate?: boolean }) {
  const days = daysUntil(dueDate);
  const tone = deadlineTone(days);
  const t = toneClasses[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold tabular-nums ring-1 ring-inset",
        t.bg,
        t.text,
        t.ring,
      )}
    >
      {formatDaysLeft(days)}
      {showDate && <span className="text-[10px] font-normal opacity-70">· {formatDate(dueDate)}</span>}
    </span>
  );
}
