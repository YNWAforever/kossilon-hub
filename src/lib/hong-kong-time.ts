const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Unable to derive ${type} from Hong Kong business date.`);
  }

  return part.value;
}

/**
 * The firm's operational "today" in Hong Kong time, as a date-only string.
 * Shared so callers on the server (reminder sweeps) and in the browser
 * (deadline pills) derive the same calendar day rather than each drifting
 * off its own local clock.
 */
export function hongKongBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce whatever a caller has to the firm's business date.
 *
 * The cron tick carries a full ISO instant, while the reminder sweeps compare
 * against `date` columns and render the result into a client-facing message.
 * Those two are not the same value: Hong Kong is UTC+8, so an instant between
 * 16:00Z and 24:00Z already belongs to the next Hong Kong day, and a sweep fed
 * the raw instant worked yesterday's book and quoted one day too many.
 *
 * A bare YYYY-MM-DD is returned untouched on purpose. It is already the firm's
 * day, and projecting it through a timezone is what would move it.
 */
export function toHongKongBusinessDate(value: string | Date): string {
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    // Shape is not validity. "2026-13-45" is ten characters in the right
    // pattern, and passing it through would make it a sweep window and a
    // rendered due date for a day that does not exist. `Date.UTC` normalises
    // out-of-range parts by rolling over, so the check is that the round trip
    // lands back on the same three numbers.
    const [year, month, day] = value.split("-").map(Number);
    const roundTrip = new Date(Date.UTC(year, month - 1, day));

    if (
      roundTrip.getUTCFullYear() !== year ||
      roundTrip.getUTCMonth() !== month - 1 ||
      roundTrip.getUTCDate() !== day
    ) {
      throw new Error(`Unable to derive a Hong Kong business date from "${value}".`);
    }

    return value;
  }

  const instant = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Unable to derive a Hong Kong business date from "${String(value)}".`);
  }

  return hongKongBusinessDate(instant);
}
