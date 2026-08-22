import type { IncorporationStatus } from "./types";
import { INCORPORATION_STATUSES } from "./types";

export function isAllowedIntakeStatusTransition(
  from: IncorporationStatus,
  to: IncorporationStatus,
): boolean {
  const fromIndex = INCORPORATION_STATUSES.indexOf(from);
  const toIndex = INCORPORATION_STATUSES.indexOf(to);

  if (fromIndex < 0 || toIndex < 0) return false;

  return toIndex === fromIndex + 1;
}

/**
 * The first calendar anniversary of a date — the statutory basis for a new
 * company's first annual return. A genuine year increment, not +365 days,
 * since a flat day count is wrong across a leap year.
 */
export function oneYearLater(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const value = new Date(Date.UTC(year + 1, month - 1, day));
  return value.toISOString().slice(0, 10);
}
