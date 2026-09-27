import type { PersistedWorkItem } from "./repository";
import type { SlaDisplayState } from "./sla";

export type WorkQueueDisplayFilters = {
  view: "mine" | "team" | "breached";
  owner: string;
  workType: string;
  sla: "all" | SlaDisplayState;
  priority: "all" | "high" | "normal";
  status: "all" | PersistedWorkItem["status"];
  q: string;
};

/** Shared predicate for the visible queue and the server-owned bulk filter snapshot. */
export function filterWorkQueueDisplay(
  items: readonly PersistedWorkItem[],
  filters: WorkQueueDisplayFilters,
  slaStateFor: (item: PersistedWorkItem) => SlaDisplayState,
): PersistedWorkItem[] {
  const needle = filters.q.trim().toLowerCase();
  return items.filter((item) => {
    const matchesQuery =
      !needle ||
      `${item.title} ${item.workType} ${item.annualReturnCaseId ?? ""} ${item.companyId}`
        .toLowerCase()
        .includes(needle);
    const matchesOwner =
      filters.owner === "all" ||
      (filters.owner === "unassigned" ? !item.ownerId : item.ownerId === filters.owner);
    const matchesWorkType = filters.workType === "all" || item.workType === filters.workType;
    const state = slaStateFor(item);
    const matchesSla = filters.sla === "all" || state === filters.sla;
    const matchesView = filters.view !== "breached" || state === "breached";
    const matchesPriority =
      filters.priority === "all" ||
      (filters.priority === "high" ? item.priority >= 70 : item.priority < 70);
    const matchesStatus = filters.status === "all" || item.status === filters.status;
    return (
      matchesView &&
      matchesQuery &&
      matchesOwner &&
      matchesWorkType &&
      matchesSla &&
      matchesPriority &&
      matchesStatus
    );
  });
}
