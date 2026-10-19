// Display formatting for the ISO date strings the repositories return.
// Lives outside lib/mock-data so production screens do not import fixtures
// to render a date.
import { toHongKongBusinessDate } from "@/lib/hong-kong-time";

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

/**
 * Renders the given date, not the viewer's guess at it.
 *
 * `new Date("2026-07-05")` is UTC midnight, and toLocaleDateString then moves it
 * into the runtime's zone -- so a viewer anywhere west of Greenwich saw a filing
 * due date one day earlier than the one the firm files against. A calendar date
 * is a fact about the calendar, so it is formatted straight from its parts and
 * no timezone is involved. A full instant is resolved to the Hong Kong day it
 * falls in, because the firm's screens speak the firm's day wherever they are
 * opened.
 */
export const formatDate = (isoDate: string) => {
  const [year, month, day] = toHongKongBusinessDate(isoDate).split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
};

/**
 * The same calendar day for English text written to a client (the WhatsApp AI
 * draft), e.g. "12 Aug 2026". The UI itself uses formatDate.
 */
export const formatDateEnglish = (isoDate: string) => {
  const [year, month, day] = toHongKongBusinessDate(isoDate).split("-");
  return `${day} ${MONTH_LABELS[Number(month) - 1] ?? month} ${year}`;
};

const hongKongTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Hong_Kong",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** An instant as its Hong Kong date and 24-hour time, e.g. "2026年6月11日 09:00". */
export const formatDateTime = (instant: string) =>
  `${formatDate(instant)} ${hongKongTime.format(new Date(instant))}`;

/**
 * A due date with how far away it is, e.g. "2026年6月10日 · 已逾期 124 日".
 * `daysRemaining` is passed in rather than derived so each screen keeps its own
 * notion of "today" (fixtures pin one; production uses the Hong Kong day).
 */
export const formatDueDate = (dueDate: string, daysRemaining: number) => {
  const date = formatDate(dueDate);
  if (daysRemaining < 0) return `${date} · 已逾期 ${Math.abs(daysRemaining)} 日`;
  if (daysRemaining === 0) return `${date} · 今日到期`;
  return `${date} · 尚餘 ${daysRemaining} 日`;
};
