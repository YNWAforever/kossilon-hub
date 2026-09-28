import type postgres from "postgres";

/**
 * Lock the same user/profile rows that staff disable and team changes update.
 * A pending assignment waits for the access change, then rechecks active state
 * under READ COMMITTED before its own case/work-item update.
 */
export async function assertAssignableStaffTarget(
  tx: postgres.TransactionSql,
  userId: string,
  expectedTeamId?: string | null,
): Promise<void> {
  const [target] = await tx<{ id: string }[]>`
    select u.id from users u
    join staff_profiles sp on sp.user_id=u.id
    where u.id=${userId} and u.active=true and sp.active=true
      and u.role=sp.role and u.team_id is not distinct from sp.team_id
      and sp.role in ('Admin','Manager','Staff')
      and (${expectedTeamId ?? null}::uuid is null
        or sp.team_id=${expectedTeamId ?? null}::uuid)
    for share of u,sp
  `;
  if (!target)
    throw new Error("Assignment target is inactive, unprovisioned or outside the permitted team.");
}
