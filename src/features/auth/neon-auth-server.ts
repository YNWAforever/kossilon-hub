import { getSqlClient, type SqlClient } from "@/server/db/client";
import {
  assertClientCompanyAccess,
  assertStaffAccess,
  type ClientCompanyMembership,
} from "./authorization";
import type { AuthenticatedActor, AuthRole, VerifiedAuthUser } from "./types";

type NeonSession = { user: VerifiedAuthUser };

export type NeonSessionAdapter = {
  getSession(request: Request): Promise<NeonSession | null>;
  signOut(request: Request): Promise<Response>;
};

type StaffProfileRow = {
  user_id: string;
  role: string;
  team_id: string | null;
  active: boolean;
};

type ClientMembershipRow = {
  company_id: string;
  active: boolean;
};

export type AuthDependencies = {
  auth?: NeonSessionAdapter;
  sql?: SqlClient;
};

export function getNeonAuthUrl(): string {
  const value = process.env.NEON_AUTH_URL?.trim();

  if (!value) {
    throw new Error("NEON_AUTH_URL is required.");
  }

  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("NEON_AUTH_URL must use HTTPS.");
  }

  return url.toString().replace(/\/$/, "");
}

function requestHeaders(request: Request): Headers {
  const headers = new Headers({ accept: "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

export function createNeonSessionAdapter(
  url = getNeonAuthUrl(),
  fetcher: typeof fetch = fetch,
): NeonSessionAdapter {
  return {
    async getSession(request) {
      const response = await fetcher(`${url}/get-session`, {
        method: "GET",
        headers: requestHeaders(request),
      });

      if (response.status === 401) return null;
      if (!response.ok) throw new Error("Neon Auth session verification failed.");

      const value = (await response.json()) as Partial<NeonSession> | null;
      if (
        !value?.user ||
        typeof value.user.id !== "string" ||
        typeof value.user.email !== "string"
      ) {
        return null;
      }

      return { user: value.user };
    },

    signOut(request) {
      return fetcher(`${url}/sign-out`, {
        method: "POST",
        headers: requestHeaders(request),
      });
    },
  };
}

function normalizeRole(value: string): AuthRole {
  if (value === "Admin" || value === "Manager" || value === "Staff" || value === "Client") {
    return value;
  }

  throw new Error("Forbidden: staff profile has an invalid role.");
}

export async function requireActor(
  request: Request,
  dependencies: AuthDependencies = {},
): Promise<AuthenticatedActor> {
  const auth = dependencies.auth ?? createNeonSessionAdapter();
  const sql = dependencies.sql ?? getSqlClient();
  const session = await auth.getSession(request);

  if (!session) {
    throw new Error("Unauthorized: a verified Neon Auth session is required.");
  }

  const staffRows = await sql<StaffProfileRow[]>`
    select user_id, role, team_id, active
    from staff_profiles
    where auth_user_id = ${session.user.id}
    limit 1
  `;
  const staff = staffRows[0];

  if (staff) {
    return {
      authUserId: session.user.id,
      userId: staff.user_id,
      role: normalizeRole(staff.role),
      teamId: staff.team_id,
      active: staff.active,
    };
  }

  const membershipRows = await sql<ClientMembershipRow[]>`
    select company_id, active
    from client_company_memberships
    where auth_user_id = ${session.user.id}
      and active = true
    limit 1
  `;
  const membership = membershipRows[0];

  if (!membership) {
    throw new Error("Forbidden: user is not provisioned with an active company membership.");
  }

  return {
    authUserId: session.user.id,
    userId: null,
    role: "Client",
    teamId: null,
    active: membership.active,
  };
}

export async function requireStaffActor(
  request: Request,
  dependencies: AuthDependencies = {},
): Promise<AuthenticatedActor> {
  return assertStaffAccess(await requireActor(request, dependencies));
}

export async function requireClientCompanyAccess(
  request: Request,
  companyId: string,
  dependencies: AuthDependencies = {},
): Promise<AuthenticatedActor> {
  const actor = await requireActor(request, dependencies);
  const sql = dependencies.sql ?? getSqlClient();
  const rows = await sql<ClientMembershipRow[]>`
    select company_id, active
    from client_company_memberships
    where auth_user_id = ${actor.authUserId}
      and company_id = ${companyId}
  `;
  const memberships: ClientCompanyMembership[] = rows.map((row) => ({
    companyId: row.company_id,
    active: row.active,
  }));

  return assertClientCompanyAccess(actor, companyId, memberships);
}
