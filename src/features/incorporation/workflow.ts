import type { IncorporationStatus } from "./types";
import { INCORPORATION_STATUSES } from "./types";

export { oneYearLater } from "@/lib/date-math";

export function isAllowedIntakeStatusTransition(
  from: IncorporationStatus,
  to: IncorporationStatus,
): boolean {
  const fromIndex = INCORPORATION_STATUSES.indexOf(from);
  const toIndex = INCORPORATION_STATUSES.indexOf(to);

  // indexOf returns -1 for a status outside the enum, which made `toIndex ===
  // fromIndex + 1` true for an unknown `from` and the very first status — moving
  // a case with a drifted status backwards to the start of the workflow.
  if (fromIndex < 0 || toIndex < 0) return false;

  return toIndex === fromIndex + 1;
}
