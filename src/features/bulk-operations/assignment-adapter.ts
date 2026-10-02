import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import { createWorkItemRepository } from "@/features/work-items/repository";
import type { BulkResource, Assignment } from "./types";
export type AssignmentCommand = {
  resource: BulkResource;
  id: string;
  expectedVersion: string;
  assignment: Assignment;
};
export async function applyAssignment(
  tx: postgres.TransactionSql,
  actor: AuthenticatedActor,
  command: AssignmentCommand,
) {
  if (command.resource === "annual_return_case") {
    const service = createAnnualReturnRepository({ sql: tx });
    const common = {
      caseId: command.id,
      actorId: actor.userId!,
      expectedVersion: command.expectedVersion,
    };
    if (command.assignment.target === "owner")
      await service.assignOwner({ ...common, ownerId: command.assignment.assigneeId });
    else await service.assignReviewer({ ...common, reviewerId: command.assignment.assigneeId });
  } else
    await createWorkItemRepository({ sql: tx }).assign({
      workItemId: command.id,
      selectedUserId: command.assignment.assigneeId,
      assignedById: actor.userId!,
      expectedVersion: Number(command.expectedVersion),
      assignmentTarget: command.assignment.target,
      overrideReason: command.assignment.overrideReason,
      expectedTeamId: actor.role === "Manager" ? actor.teamId! : undefined,
    });
}
