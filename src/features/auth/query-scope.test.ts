import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { ensureActorQueryScope } from "./query-scope";
import type { AuthenticatedActor } from "./types";
it("removes private records on account, scope and sign-out transitions while retaining same-actor recovery", async () => {
  const client = new QueryClient();
  const a: AuthenticatedActor = {
    authUserId: "A",
    userId: "A",
    role: "Client",
    teamId: null,
    active: true,
  };
  await ensureActorQueryScope(client, a);
  client.setQueryData(["client-portal", "case", "private"], { fileName: "A private.pdf" });
  await ensureActorQueryScope(client, { ...a });
  expect(client.getQueryData(["client-portal", "case", "private"])).toBeTruthy();
  await ensureActorQueryScope(client, { ...a, authUserId: "B" });
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  client.setQueryData(["private"], "B data");
  await ensureActorQueryScope(client, null);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
