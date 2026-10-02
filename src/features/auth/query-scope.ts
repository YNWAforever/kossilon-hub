import type { QueryClient } from "@tanstack/react-query";
import type { AuthenticatedActor } from "./types";

const scopes = new WeakMap<QueryClient, string>();
/** Called by the verified root loader before any account's route mounts. */
export async function ensureActorQueryScope(client: QueryClient, actor: AuthenticatedActor | null) {
  const scope = JSON.stringify(actor);
  const previous = scopes.get(client);
  if (previous !== undefined && previous !== scope) {
    await client.cancelQueries();
    client.clear();
  }
  scopes.set(client, scope);
}
