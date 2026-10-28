import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";

const auth = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/auth/neon-auth-rpc", () => ({ getAuthenticatedActor: auth.read }));
vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));
import { Route } from "./__root";

type GuardInput = {
  context: { queryClient: QueryClient; dataMode: "production"; actor: null };
  location: { pathname: string; href: string };
};
const guard = Route.options.beforeLoad as (input: GuardInput) => Promise<unknown>;
function enter(path: string) {
  return guard({
    context: { queryClient: new QueryClient(), dataMode: "production", actor: null },
    location: { pathname: path.split("?")[0], href: path },
  });
}
const staff: AuthenticatedActor = {
  authUserId: "synthetic-staff",
  userId: "synthetic-staff",
  role: "Staff",
  teamId: "synthetic-team",
  active: true,
};

describe("marketing and protected root beforeLoad", () => {
  it.each(["/", "/en", "/login"])("allows %s when authentication is unavailable", async (path) => {
    auth.read.mockRejectedValue(new Error("Unauthorized: no session"));
    await expect(enter(path)).resolves.toEqual({ actor: null });
  });

  it.each(["/dashboard", "/today", "/portal", "/documents", "/en/admin"])(
    "requires authentication for %s and retains the return path",
    async (path) => {
      auth.read.mockRejectedValue(new Error("Unauthorized: no session"));
      await expect(enter(path)).rejects.toMatchObject({
        options: { href: `/login?redirect=${encodeURIComponent(path)}`, replace: true },
      });
    },
  );

  it("lets staff reach their moved dashboard", async () => {
    auth.read.mockResolvedValue(staff);
    await expect(enter("/dashboard")).resolves.toEqual({ actor: staff });
  });

  it("keeps Clients out of the staff dashboard and in their portal", async () => {
    const client = { ...staff, role: "Client" };
    auth.read.mockResolvedValue(client);
    await expect(enter("/dashboard")).rejects.toMatchObject({
      options: { href: "/portal", replace: true },
    });
    await expect(enter("/portal")).resolves.toEqual({ actor: client });
  });

  it("retains the denied-account explanation on protected routes", async () => {
    auth.read.mockRejectedValue(new Error("Forbidden: not provisioned"));
    await expect(enter("/dashboard")).rejects.toMatchObject({
      options: { href: "/login?denied=1&redirect=%2Fdashboard", replace: true },
    });
  });
});
