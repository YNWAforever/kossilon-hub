import type postgres from "postgres";
import type { AuthRole } from "./types";
import type { SqlClient } from "@/server/db/client";

/** Keep a verified identity's access state stable until the domain write commits. */
export async function lockActiveStaffUser(tx: postgres.TransactionSql, userId: string) {
  return readActiveStaffUser(tx, userId, true);
}
export async function readActiveStaffUser(
  tx: postgres.TransactionSql | SqlClient,
  userId: string,
  lock = false,
) {
  const [user] = await tx<{ id: string; role: AuthRole; team_id: string | null }[]>`
    select u.id,u.role,u.team_id from users u join staff_profiles sp on sp.user_id=u.id
    where u.id=${userId} and u.active and sp.active
      and u.role in ('Admin','Manager','Staff') and u.role=sp.role
      and u.team_id is not distinct from sp.team_id
    ${lock ? tx`for share of u,sp` : tx``}
  `;
  if (!user) throw new Error("Staff user is inactive, inconsistent or ineligible.");
  return user;
}
