import type postgres from "postgres";

/**
 * Admit responsibility writes before any row/company/actor/job locks in the
 * outermost transaction. Disable/handover takes the same key exclusively first.
 * Nested shared admission is safe; never upgrade a shared admission to exclusive.
 */
export async function lockStaffLifecycleShared(tx: postgres.TransactionSql): Promise<void> {
  await tx`select pg_advisory_xact_lock_shared(hashtext('kossilon_staff_admin_lifecycle'))`;
}

/** Acquire first in a lifecycle transaction, before taking any domain locks. */
export async function lockStaffLifecycleExclusive(tx: postgres.TransactionSql): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtext('kossilon_staff_admin_lifecycle'))`;
}
