/** Shared, bounded selection state for case, client and work-queue bulk screens. */
export type BulkSelectionState = {
  filterKey: string;
  ids: string[];
  notice: string | null;
};

const MAX_SELECTION = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newBulkSelection(filterKey: string): BulkSelectionState {
  if (!filterKey) throw new Error("A selection filter key is required.");
  return { filterKey, ids: [], notice: null };
}

export function addPageToSelection(
  state: BulkSelectionState,
  pageIds: readonly string[],
): BulkSelectionState {
  for (const id of pageIds) if (!UUID.test(id)) throw new Error("A valid resource ID is required.");
  const ids = [...new Set([...state.ids, ...pageIds])];
  if (ids.length > MAX_SELECTION) throw new Error("Selection exceeds the 1000-item limit.");
  return { ...state, ids, notice: null };
}

export function removeFromSelection(state: BulkSelectionState, id: string): BulkSelectionState {
  return { ...state, ids: state.ids.filter((selected) => selected !== id), notice: null };
}

export function clearBulkSelection(state: BulkSelectionState): BulkSelectionState {
  return { ...state, ids: [], notice: null };
}

export function changeSelectionFilter(
  state: BulkSelectionState,
  filterKey: string,
): BulkSelectionState {
  if (!filterKey) throw new Error("A selection filter key is required.");
  if (state.filterKey === filterKey) return state;
  return {
    filterKey,
    ids: [],
    notice: state.ids.length ? "Selection cleared because the filter changed." : null,
  };
}

export function retryFailedSelection(
  filterKey: string,
  operationItems: readonly { resourceId: string; state: string }[],
): BulkSelectionState {
  return addPageToSelection(
    newBulkSelection(filterKey),
    operationItems.filter((item) => item.state === "failed").map((item) => item.resourceId),
  );
}
