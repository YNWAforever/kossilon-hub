export type ClientStatusFilter = "active" | "inactive" | "all";

/**
 * The register's URL state. Filter fields are optional so an absent param and a
 * cleared filter are the same thing; status always resolves because the register
 * hides deactivated companies by default.
 */
export type ClientRegisterSearch = {
  q?: string;
  packageName?: string;
  teamName?: string;
  status: ClientStatusFilter;
};

const STATUS_FILTERS: readonly ClientStatusFilter[] = ["active", "inactive", "all"];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Sanitises a user-editable URL. Anything unrecognised degrades to the default
 * rather than throwing — a typo in the address bar must not break the screen.
 */
export function clientSearchFromUrl(search: Record<string, unknown>): ClientRegisterSearch {
  const status = search.status as ClientStatusFilter;

  return {
    q: text(search.q),
    packageName: text(search.packageName),
    teamName: text(search.teamName),
    status: STATUS_FILTERS.includes(status) ? status : "active",
  };
}
