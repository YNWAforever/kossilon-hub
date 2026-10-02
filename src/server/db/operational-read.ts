import type postgres from "postgres";
import type { SqlClient } from "./client";
type Query = SqlClient | postgres.TransactionSql;
/** Complex operational predicates otherwise spend seconds in JIT compilation.
 * Keep tuning transaction-local, including when called in an existing transaction.
 */
export async function operationalRead<T>(
  sql: Query,
  read: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const run = async (tx: postgres.TransactionSql) => {
    const [prior] = await tx<{ jit: string }[]>`select current_setting('jit') jit`;
    await tx`select set_config('jit','off',true)`;
    const result = await read(tx);
    await tx`select set_config('jit',${prior.jit},true)`;
    return result;
  };
  return ("begin" in sql ? sql.begin(run) : sql.savepoint(run)) as Promise<T>;
}
