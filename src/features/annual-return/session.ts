import { requireStaffActor, type AuthDependencies } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";

export async function getCurrentAnnualReturnActor(
  request: Request,
  dependencies: AuthDependencies = {},
): Promise<AuthenticatedActor> {
  return requireStaffActor(request, dependencies);
}

export async function getCurrentAnnualReturnActorId(
  request: Request,
  dependencies: AuthDependencies = {},
): Promise<string> {
  const actor = await getCurrentAnnualReturnActor(request, dependencies);

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return actor.userId;
}
