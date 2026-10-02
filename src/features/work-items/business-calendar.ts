import type { BusinessCalendar, BusinessInterval, Weekday } from "./types";

const MINUTE_MS = 60_000;
const MAX_MINUTES_TO_SCAN = 10 * 366 * 24 * 60;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type LocalMinute = {
  date: string;
  weekday: Weekday;
  minuteOfDay: number;
};

function parseTime(value: string): number {
  if (!TIME_PATTERN.test(value)) {
    throw new Error(`Business interval time must use HH:mm: ${value}`);
  }

  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function validateIntervals(intervals: readonly BusinessInterval[]): void {
  let previousEnd = -1;

  for (const interval of intervals) {
    const start = parseTime(interval.start);
    const end = parseTime(interval.end);
    if (end <= start) throw new Error("Business interval end must be after its start.");
    if (start < previousEnd) throw new Error("Business intervals must not overlap.");
    previousEnd = end;
  }
}

function localMinuteAt(instant: Date, formatter: Intl.DateTimeFormat): LocalMinute {
  const parts = formatter.formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = values.weekday?.toLowerCase() as Weekday;

  if (!values.year || !values.month || !values.day || !values.hour || !values.minute) {
    throw new Error("Unable to resolve business calendar timezone.");
  }

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  };
}

function intervalsFor(local: LocalMinute, calendar: BusinessCalendar): readonly BusinessInterval[] {
  const holiday = calendar.holidays.find((candidate) => candidate.date === local.date);
  if (holiday) {
    if (holiday.closed) return [];
    return holiday.workingIntervals ?? [];
  }

  return calendar.weeklySchedule[local.weekday] ?? [];
}

function isBusinessMinute(
  instant: Date,
  calendar: BusinessCalendar,
  formatter: Intl.DateTimeFormat,
): boolean {
  const local = localMinuteAt(instant, formatter);
  const intervals = intervalsFor(local, calendar);
  validateIntervals(intervals);

  return intervals.some((interval) => {
    const start = parseTime(interval.start);
    const end = parseTime(interval.end);
    return local.minuteOfDay >= start && local.minuteOfDay < end;
  });
}

export function addBusinessMinutes(
  startedAt: string,
  minutes: number,
  calendar: BusinessCalendar,
): string {
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) throw new Error("A valid start timestamp is required.");
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new Error("Business minutes must be a non-negative integer.");
  }

  // Formatter construction is expensive. Reuse it for this invocation while
  // formatting each actual instant, preserving DST and caller-calendar changes.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: calendar.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  // Validate the timezone even when no time needs to be added.
  localMinuteAt(started, formatter);
  if (minutes === 0) return started.toISOString();

  let remainingMs = minutes * MINUTE_MS;
  let scanned = 0;
  let cursor = started;

  while (remainingMs > 0) {
    const elapsedWithinMinute = cursor.getUTCSeconds() * 1_000 + cursor.getUTCMilliseconds();
    const untilNextMinute = MINUTE_MS - elapsedWithinMinute;

    if (isBusinessMinute(cursor, calendar, formatter)) {
      const consumed = Math.min(untilNextMinute, remainingMs);
      remainingMs -= consumed;
      cursor = new Date(cursor.getTime() + consumed);
    } else {
      cursor = new Date(cursor.getTime() + untilNextMinute);
    }

    scanned += 1;

    if (scanned > MAX_MINUTES_TO_SCAN) {
      throw new Error("Business calendar has no reachable working interval.");
    }
  }

  return cursor.toISOString();
}
