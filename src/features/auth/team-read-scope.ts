import { z } from "zod";
import type { AuthenticatedActor } from "./types";

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("team"), teamId: z.string().uuid() }).strict(),
]);
export type TeamReadScope = z.infer<typeof scopeSchema>;

/** Only incorporation/change reads use this policy; other features keep their own rules. */
export function requireTeamReadScope(actor: AuthenticatedActor): TeamReadScope {
  if (
    !actor.active ||
    !actor.userId ||
    !actor.authUserId ||
    !["Admin", "Manager", "Staff"].includes(actor.role)
  ) {
    throw new Error("Forbidden: verified active staff identity required.");
  }
  if (actor.role === "Admin") return { kind: "all" };
  return assertTeamReadScope({ kind: "team", teamId: actor.teamId });
}

/** Runtime callers cannot turn an omitted/invalid team into unrestricted SQL. */
export function assertTeamReadScope(scope: unknown): TeamReadScope {
  const result = scopeSchema.safeParse(scope);
  if (!result.success) throw new Error("Forbidden: an explicit valid team read scope is required.");
  return result.data;
}
