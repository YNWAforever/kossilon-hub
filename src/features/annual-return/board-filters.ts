import { ANNUAL_RETURN_STATUSES, type AnnualReturnStatus, type RiskLevel } from "./types";

const RISK_LEVELS: readonly RiskLevel[] = ["green", "yellow", "orange", "red"];

/**
 * The board's URL state. Every field is optional so an absent search param and a
 * cleared filter are the same thing.
 */
export type AnnualReturnBoardSearch = {
  q?: string;
  status?: AnnualReturnStatus;
  risk?: RiskLevel;
  ownerId?: string;
  overdueOnly?: boolean;
};

export type AnnualReturnBoardFilters = {
  limit: number;
  q?: string;
  cursor?: string;
  status?: AnnualReturnStatus;
  risk?: RiskLevel;
  ownerId?: string;
  overdueOnly?: true;
};

/**
 * Maps URL state onto the server filter set.
 *
 * `q` used to be deliberately absent here, filtered in the browser over whatever
 * the 200-row page happened to contain -- so a case at row 201 could not be found
 * by typing its name, and the owner dropdown that might have narrowed the query
 * was itself built from that same truncated page. It is now a SQL predicate over
 * company name and CR number.
 *
 * Keys are omitted rather than set to undefined so the query key stays stable and
 * the Zod schema sees the same shape whether or not a filter is set.
 */
export function boardFiltersFromSearch(
  search: AnnualReturnBoardSearch,
  limit: number,
  cursor?: string,
): AnnualReturnBoardFilters {
  return {
    limit,
    ...(search.q ? { q: search.q } : {}),
    ...(cursor ? { cursor } : {}),
    ...(search.status ? { status: search.status } : {}),
    ...(search.risk ? { risk: search.risk } : {}),
    ...(search.ownerId ? { ownerId: search.ownerId } : {}),
    ...(search.overdueOnly ? { overdueOnly: true as const } : {}),
  };
}

/**
 * Sanitises raw URL search params. Anything unrecognised becomes undefined rather
 * than reaching the query: the server's Zod schema would reject an invalid status
 * with a round trip, and a `<select>` given an unknown value silently renders as
 * if nothing were selected.
 *
 * Lives here rather than inline in the route so it can be tested directly — a
 * route file cannot export a non-component without tripping react-refresh.
 */
export function boardSearchFromUrl(search: Record<string, unknown>): AnnualReturnBoardSearch {
  const status = search.status as AnnualReturnStatus;
  const risk = search.risk as RiskLevel;

  return {
    q: typeof search.q === "string" && search.q.length > 0 ? search.q : undefined,
    status: ANNUAL_RETURN_STATUSES.includes(status) ? status : undefined,
    risk: RISK_LEVELS.includes(risk) ? risk : undefined,
    ownerId:
      typeof search.ownerId === "string" && search.ownerId.length > 0 ? search.ownerId : undefined,
    overdueOnly: search.overdueOnly === true || search.overdueOnly === "true" ? true : undefined,
  };
}
