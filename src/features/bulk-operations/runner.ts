import { createBulkOperationRepository } from "./repository";

/** One bounded scheduler pass. Assignment is SQL-only and each item uses its existing domain service. */
export async function runDueBulkOperations(
  options: {
    maxOperations?: number;
    maxItemsPerOperation?: number;
    repository?: ReturnType<typeof createBulkOperationRepository>;
  } = {},
) {
  const maxOperations = options.maxOperations ?? 5;
  const maxItemsPerOperation = options.maxItemsPerOperation ?? 100;
  const repository = options.repository ?? createBulkOperationRepository();
  try {
    const ids = await repository.listDueOperationIds(maxOperations);
    const results = [];
    for (const id of ids)
      results.push(await repository.runBatch(id, { limit: maxItemsPerOperation }));
    return {
      operations: results.length,
      remaining: results.reduce(
        (count, result) =>
          count + result.counts.pending + result.counts.running + result.counts.failed,
        0,
      ),
    };
  } finally {
    if (!options.repository) await repository.close();
  }
}
