import type { StaffInviteProvider } from "./repository";

/**
 * Neon Auth session verification is configured in neon-auth-server.ts, but
 * this tenant has no verified app-staff invitation API or scoped management
 * credential. Do not confuse Neon project-member invites or create-user with
 * an app-staff invitation. The repository port is exercised only with an
 * explicit test adapter until the tenant contract is proven.
 */
export function verifiedStaffInviteProvider(): StaffInviteProvider | null {
  return null;
}
