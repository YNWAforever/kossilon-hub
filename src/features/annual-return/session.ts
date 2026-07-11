import {
  requireStaffActor,
  type AuthDependencies,
} from "@/features/auth/neon-auth-server";

export async function getCurrentAnnualReturnActorId(
  request: Request,
  dependencies: AuthDependencies = {},
): Promise<string> {
  const actor = await requireStaffActor(request, dependencies);

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return actor.userId;
}
