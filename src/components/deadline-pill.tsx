import { cn } from "@/lib/utils";
import { deadlineTone, formatDaysLeft, toneClasses } from "@/lib/status";

const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Unable to derive ${type} from Hong Kong business date.`);
  }

  return part.value;
}

function hongKongBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function utcTimeForDateOnly(value: string): number {
  const [year, month, day] = dateOnly(value).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function daysUntilDateOnly(dueDate: string, today = hongKongBusinessDate()): number {
  return Math.floor((utcTimeForDateOnly(dueDate) - utcTimeForDateOnly(today)) / MS_PER_DAY);
}

function formatDateOnly(value: string): string {
  const [year, month, day] = dateOnly(value).split("-");
  const monthLabel = MONTH_LABELS[Number(month) - 1] ?? month;

  return `${day} ${monthLabel} ${year}`;
}

export function DeadlinePill({
  dueDate,
  showDate = false,
}: {
  dueDate: string;
  showDate?: boolean;
}) {
  const days = daysUntilDateOnly(dueDate);
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
      {showDate && (
        <span className="text-[10px] font-normal opacity-70">· {formatDateOnly(dueDate)}</span>
      )}
    </span>
  );
}
