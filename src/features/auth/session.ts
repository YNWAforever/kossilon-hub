import type { AuthRole } from "./types";
export type { AuthRole } from "./types";

export const AUTH_SESSION_STORAGE_KEY = "kossilon.auth.session.v1";


export type DemoUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: AuthRole;
  initials: string;
  team: string;
  active: boolean;
  lastLoginAt: string;
};

export type AuthSession = {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
  initials: string;
  team: string;
  signedInAt: string;
};

export type AuthResult = { ok: true; session: AuthSession } | { ok: false; error: string };

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type NowProvider = () => string;

export const demoUsers: DemoUser[] = [
  {
    id: "u-amy",
    name: "Amy Chan",
    email: "admin@kossilon.test",
    password: "admin-demo",
    role: "Admin",
    initials: "AC",
    team: "Filing Team A",
    active: true,
    lastLoginAt: "2026-07-07T08:45:00.000Z",
  },
  {
    id: "u-ken",
    name: "Ken Wong",
    email: "manager@kossilon.test",
    password: "manager-demo",
    role: "Manager",
    initials: "KW",
    team: "Filing Team A",
    active: true,
    lastLoginAt: "2026-07-06T17:30:00.000Z",
  },
  {
    id: "u-mei",
    name: "Mei Lam",
    email: "staff@kossilon.test",
    password: "staff-demo",
    role: "Staff",
    initials: "ML",
    team: "Filing Team B",
    active: true,
    lastLoginAt: "2026-07-06T16:20:00.000Z",
  },
];

function browserStorage(): SessionStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function systemNow(): string {
  return new Date().toISOString();
}

function toSession(user: DemoUser, signedInAt: string): AuthSession {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    initials: user.initials,
    team: user.team,
    signedInAt,
  };
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AuthSession>;
  return (
    typeof session.id === "string" &&
    typeof session.name === "string" &&
    typeof session.email === "string" &&
    (session.role === "Admin" ||
      session.role === "Manager" ||
      session.role === "Staff" ||
      session.role === "Client") &&
    typeof session.initials === "string" &&
    typeof session.team === "string" &&
    typeof session.signedInAt === "string"
  );
}

export function getStoredSession(storage = browserStorage()): AuthSession | null {
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (isAuthSession(parsed)) return parsed;
  } catch {
    clearStoredSession(storage);
    return null;
  }

  clearStoredSession(storage);
  return null;
}

export function storeSession(session: AuthSession, storage = browserStorage()): void {
  if (!storage) return;

  try {
    storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Local demo auth should not crash if browser storage is unavailable.
  }
}

export function clearStoredSession(storage = browserStorage()): void {
  if (!storage) return;

  try {
    storage.removeItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Local demo auth should not crash if browser storage is unavailable.
  }
}

export function loginWithCredentials(
  email: string,
  password: string,
  storage = browserStorage(),
  now: NowProvider = systemNow,
): AuthResult {
  const normalizedEmail = email.trim().toLowerCase();
  const user = demoUsers.find(
    (candidate) =>
      candidate.active &&
      candidate.email.toLowerCase() === normalizedEmail &&
      candidate.password === password,
  );

  if (!user) {
    return { ok: false, error: "Email or password is incorrect." };
  }

  const session = toSession(user, now());
  storeSession(session, storage);
  return { ok: true, session };
}

export function loginAsDemoUser(
  userId: string,
  storage = browserStorage(),
  now: NowProvider = systemNow,
): AuthResult {
  const user = demoUsers.find((candidate) => candidate.active && candidate.id === userId);

  if (!user) {
    return { ok: false, error: "Demo user is unavailable." };
  }

  const session = toSession(user, now());
  storeSession(session, storage);
  return { ok: true, session };
}

export function loginWithDemoUser(
  user: DemoUser,
  storage = browserStorage(),
  now: NowProvider = systemNow,
): AuthResult {
  if (!user.active) {
    return { ok: false, error: "Demo user is unavailable." };
  }

  const session = toSession(user, now());
  storeSession(session, storage);
  return { ok: true, session };
}

export function logout(storage = browserStorage()): void {
  clearStoredSession(storage);
}

export function isAdmin(user?: Pick<AuthSession | DemoUser, "role"> | null): boolean {
  return user?.role === "Admin";
}
