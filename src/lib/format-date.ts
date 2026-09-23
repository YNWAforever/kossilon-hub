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
  return `${day} ${MONTH_LABELS[Number(month) - 1] ?? month} ${year}`;
};
