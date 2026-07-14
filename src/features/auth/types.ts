export type AuthRole = "Admin" | "Manager" | "Staff" | "Client";

export type AuthenticatedActor = {
  authUserId: string;
  userId: string | null;
  role: AuthRole;
  teamId: string | null;
  active: boolean;
};

export type VerifiedAuthUser = { id: string; email: string; name?: string | null };
