import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
const actor = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/neon-auth-rpc", () => ({ getAuthenticatedActor: actor }));
import { Route } from "./__root";
type Guard = (input: unknown) => Promise<unknown>;
const guard = Route.options.beforeLoad as unknown as Guard;
it("keeps a 503 on a recoverable auth error screen instead of redirecting to login", async () => {
  actor.mockRejectedValue(Object.assign(new Error("private diagnostic"), { status: 503 }));
  await expect(
    guard({
      context: { queryClient: new QueryClient(), dataMode: "production" },
      location: { pathname: "/today", href: "/today" },
    }),
  ).rejects.toMatchObject({ resolution: { kind: "transient_error" } });
});
it("keeps forbidden separate from no session", async () => {
  actor.mockRejectedValue(new Error("Forbidden: inactive"));
  await expect(
    guard({
      context: { queryClient: new QueryClient(), dataMode: "production" },
      location: { pathname: "/today", href: "/today" },
    }),
  ).rejects.toMatchObject({ resolution: { kind: "forbidden" } });
});
