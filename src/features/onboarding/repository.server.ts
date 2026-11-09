import { createSqlClient, getSqlClient } from "@/server/db/client";

import { createRequestAccessRepository } from "./repository";

/**
 * Server-only constructor for the request-access queue.
 *
 * Kept in a `.server.ts` file so importing the server functions from a route
 * never pulls the database client into the client graph (the import-protection
 * plugin rejects `**\/server/**` from client code). Call it through a dynamic
 * import inside a server-fn handler.
 */
export function createRequestAccessRepositoryForRequest() {
  return createRequestAccessRepository({ sql: getSqlClient() as never });
}

export function createRequestAccessRepositoryForDatabase(databaseUrl?: string) {
  return createRequestAccessRepository({
    sql: (databaseUrl ? createSqlClient(databaseUrl) : getSqlClient()) as never,
    ownsClient: Boolean(databaseUrl),
  });
}
