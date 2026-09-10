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

/**
 * Calendar months, clamped to the end of the target month.
 *
 * Deliberately NOT `oneYearLater`'s behaviour, and the difference is the whole
 * reason this is a separate function. That one builds its result straight from
 * `Date.UTC` and therefore rolls forward on overflow: 2028-02-29 becomes
 * 2029-03-01, which its test pins on purpose for the statutory anniversary.
 *
 * Rolling forward is wrong for an age window. "Three months before 31 May" has
 * no 31st to land on, and rolling to 3 March silently makes the window three
 * days shorter than the reader expects, at month ends only, by an amount that
 * depends on which month it is. Clamping to 28/29 February is how the phrase
 * reads to a person and how legal date arithmetic conventionally resolves it.
 *
 * This is a business rule, not a mathematical fact, and the clamp direction is
 * recorded as an open input to confirm with the firm. It matters by a few days
 * and only at month ends -- but a few days is enough to flip a verdict on
 * evidence submitted near a deadline.
 */
export function addCalendarMonths(date: string, months: number): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);

  const targetIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;

  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}
