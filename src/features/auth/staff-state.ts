import type postgres from "postgres";
import type { AuthRole } from "./types";

/** Keep a verified identity's access state stable until the domain write commits. */
export async function lockActiveStaffUser(tx: postgres.TransactionSql, userId: string) {
  const [user] = await tx<{ id: string; role: AuthRole; team_id: string | null }[]>`
    select u.id,u.role,u.team_id from users u join staff_profiles sp on sp.user_id=u.id
    where u.id=${userId} and u.active and sp.active
      and u.role in ('Admin','Manager','Staff') and u.role=sp.role
      and u.team_id is not distinct from sp.team_id
    for share of u,sp
  `;
  if (!user) throw new Error("Staff user is inactive, inconsistent or ineligible.");
  return user;
}
