import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import { getSqlClient, type SqlClient } from "@/server/db/client";

type QueryClient = SqlClient | postgres.TransactionSql;
type CaseRow = {
  id: string;
  ownerId: string;
  teamId: string;
  status: string;
  lockedAt: Date | null;
  completedAt: Date | null;
  revision: number;
};
export type CaseAssignmentPreviewItem = {
  caseId: string;
  revision: number | null;
  oldOwnerId: string | null;
  oldTeamId: string | null;
  newOwnerId: string;
  newTeamId: string | null;
  state: "eligible" | "skipped" | "conflict" | "forbidden";
  reasonCode: string | null;
};
function validIds(ids: string[]): void {
  if (ids.length < 1 || ids.length > 1000 || new Set(ids).size !== ids.length)
    throw new Error("Select 1 to 1000 distinct cases.");
  if (ids.some((id) => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
    throw new Error("A valid case ID is required.");
}
async function currentActor(sql: QueryClient, actor: AuthenticatedActor) {
  if (!actor.active || !actor.userId || (actor.role !== "Admin" && actor.role !== "Manager"))
    throw new Error("Forbidden: active Admin or Manager required.");
  const [row] = await sql<{ id: string; role: "Admin" | "Manager"; teamId: string | null }[]>`
    select u.id,u.role,u.team_id "teamId" from users u
    join staff_profiles sp on sp.user_id=u.id
    where u.id=${actor.userId} and sp.auth_user_id=${actor.authUserId}
      and u.active=true and sp.active=true and u.role=sp.role
      and u.team_id is not distinct from sp.team_id and u.role in ('Admin','Manager')`;
  if (!row || row.role !== actor.role || row.teamId !== actor.teamId)
    throw new Error("Forbidden: actor scope changed; preview again.");
  return row;
}
function transaction<T>(
  sql: QueryClient,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return "begin" in sql ? (sql.begin(work) as Promise<T>) : work(sql);
}

/** Dry-run only: selected IDs are frozen; each case receives its own decision. */
export async function previewCaseOwnerAssignmentsForActor(
  actor: AuthenticatedActor,
  input: { caseIds: string[]; ownerId: string },
  dependencies: { sql?: QueryClient } = {},
): Promise<CaseAssignmentPreviewItem[]> {
  validIds(input.caseIds);
  const sql = dependencies.sql ?? getSqlClient();
  const current = await currentActor(sql, actor);
  const [target] = await sql<{ id: string; teamId: string | null }[]>`
    select u.id,sp.team_id "teamId" from users u
    join staff_profiles sp on sp.user_id=u.id
    where u.id=${input.ownerId} and u.active=true and sp.active=true
      and u.role=sp.role and u.team_id is not distinct from sp.team_id
      and sp.role in ('Admin','Manager','Staff')`;
  const cases = await sql<CaseRow[]>`
    select arc.id,arc.owner_id "ownerId",c.assigned_team_id "teamId",
      arc.current_status status,arc.locked_at "lockedAt",arc.completed_at "completedAt",
      arc.assignment_revision revision
    from annual_return_cases arc join companies c on c.id=arc.company_id
    where arc.id=any(${input.caseIds}::uuid[])`;
  const byId = new Map(cases.map((row) => [row.id, row]));
  return input.caseIds.map((caseId) => {
    const row = byId.get(caseId);
    let state: CaseAssignmentPreviewItem["state"] = "eligible";
    let reasonCode: string | null = null;
    if (!row || (current.role === "Manager" && row.teamId !== current.teamId)) {
      state = "forbidden";
      reasonCode = "CASE_OUT_OF_SCOPE";
    } else if (row.lockedAt || row.completedAt || row.status === "Completed") {
      state = "conflict";
      reasonCode = "CASE_LOCKED";
    } else if (!target || (current.role === "Manager" && target.teamId !== row.teamId)) {
      state = "conflict";
      reasonCode = "TARGET_UNAVAILABLE";
    } else if (row.ownerId === target.id) {
      state = "skipped";
      reasonCode = "ALREADY_ASSIGNED";
    }
    return {
      caseId,
      revision: reasonCode === "CASE_OUT_OF_SCOPE" ? null : (row?.revision ?? null),
      oldOwnerId: reasonCode === "CASE_OUT_OF_SCOPE" ? null : (row?.ownerId ?? null),
      oldTeamId: reasonCode === "CASE_OUT_OF_SCOPE" ? null : (row?.teamId ?? null),
      newOwnerId: input.ownerId,
      newTeamId:
        reasonCode === "CASE_OUT_OF_SCOPE" || reasonCode === "TARGET_UNAVAILABLE"
          ? null
          : (target?.teamId ?? null),
      state,
      reasonCode,
    };
  });
}

/** One domain write for a future durable T09-style per-item runner. */
export async function applyOneCaseOwnerAssignmentForActor(
  actor: AuthenticatedActor,
  input: { caseId: string; ownerId: string; expectedAssignmentRevision: number },
  dependencies: { sql?: QueryClient } = {},
): Promise<{ caseId: string; revision: number }> {
  validIds([input.caseId]);
  if (
    !Number.isSafeInteger(input.expectedAssignmentRevision) ||
    input.expectedAssignmentRevision < 1
  )
    throw new Error("A valid assignment revision is required.");
  const sql = dependencies.sql ?? getSqlClient();
  return transaction(sql, async (tx) => {
    await currentActor(tx, actor);
    const [row] = await tx<{ revision: number }[]>`
      select assignment_revision revision from annual_return_cases
      where id=${input.caseId} for update`;
    if (!row) throw new Error("Forbidden: case unavailable.");
    if (row.revision !== input.expectedAssignmentRevision)
      throw new Error("Case owner assignment revision changed; preview again.");
    const repository = createAnnualReturnRepository({ sql: tx });
    await repository.assignOwner({
      caseId: input.caseId,
      ownerId: input.ownerId,
      actorId: actor.userId!,
      expectedAssignmentRevision: input.expectedAssignmentRevision,
    });
    return { caseId: input.caseId, revision: row.revision + 1 };
  });
}
