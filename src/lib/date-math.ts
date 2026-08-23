const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(date: string): Date {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
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

export function daysBetween(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY);
}
