/** Same separation rule in single-item mutation and bulk dry-run. */
export function assertCaseAssignmentTarget(
  target: "owner" | "reviewer",
  assigneeId: string,
  oppositeId: string | null,
  actorRole: string,
  childOppositeIds: readonly (string | null)[] = [],
) {
  if (target === "reviewer" && actorRole !== "Admin" && actorRole !== "Manager")
    throw new Error("Forbidden: current Manager or Admin required to assign a reviewer.");
  if (assigneeId === oppositeId || childOppositeIds.includes(assigneeId))
    throw new Error("Owner and reviewer must be different users.");
}
