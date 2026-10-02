import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
export async function requireCurrentNarAdmin(
  db: SqlClient | postgres.TransactionSql,
  identity: Pick<AuthenticatedActor, "userId" | "authUserId">,
  lock = false,
) {
  const [row] = await db<
    { id: string; team_id: string | null }[]
  >`select u.id,u.team_id from users u join staff_profiles sp on sp.user_id=u.id where u.id=${identity.userId ?? null} and sp.auth_user_id=${identity.authUserId} and u.active and sp.active and u.role='Admin' and sp.role=u.role and sp.team_id is not distinct from u.team_id ${lock ? db`for share of u,sp` : db``}`;
  if (!row) throw new Error("Forbidden: current verified Admin identity is required.");
  return {
    userId: row.id,
    authUserId: identity.authUserId,
    role: "Admin" as const,
    teamId: row.team_id,
    active: true,
  };
}
