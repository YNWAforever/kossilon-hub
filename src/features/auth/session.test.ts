import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_SESSION_STORAGE_KEY,
  clearStoredSession,
  demoUsers,
  getStoredSession,
  isAdmin,
  loginAsDemoUser,
  loginWithCredentials,
  loginWithDemoUser,
  logout,
} from "./session";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

class ThrowingStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  getItem(): string | null {
    throw new Error("Storage read unavailable");
  }

  setItem(): void {
    throw new Error("Storage write unavailable");
  }

  removeItem(): void {
    throw new Error("Storage removal unavailable");
  }
}

describe("auth session adapter", () => {
  let storage: MemoryStorage;
  const now = () => "2026-07-07T09:00:00.000Z";

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("signs in with valid demo credentials and stores non-sensitive session metadata", () => {
    const result = loginWithCredentials("admin@kossilon.test", "admin-demo", storage, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toMatchObject({
      id: "u-amy",
      name: "Amy Chan",
      email: "admin@kossilon.test",
      role: "Admin",
      signedInAt: "2026-07-07T09:00:00.000Z",
    });
    expect(JSON.stringify(result.session)).not.toContain("admin-demo");
    expect(getStoredSession(storage)).toEqual(result.session);
  });

  it("rejects invalid credentials without storing a session", () => {
    const result = loginWithCredentials("admin@kossilon.test", "wrong-password", storage, now);

    expect(result).toEqual({ ok: false, error: "Email or password is incorrect." });
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("signs in as a demo user by id", () => {
    const result = loginAsDemoUser("u-mei", storage, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toMatchObject({
      id: "u-mei",
      name: "Mei Lam",
      role: "Staff",
    });
  });

  it("signs in with a locally edited demo user", () => {
    const mei = demoUsers.find((user) => user.id === "u-mei")!;
    const result = loginWithDemoUser({ ...mei, role: "Manager" }, storage, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toMatchObject({
      id: "u-mei",
      name: "Mei Lam",
      role: "Manager",
    });
  });

  it("rejects locally inactive demo users", () => {
    const mei = demoUsers.find((user) => user.id === "u-mei")!;

    expect(loginWithDemoUser({ ...mei, active: false }, storage, now)).toEqual({
      ok: false,
      error: "Demo user is unavailable.",
    });
  });

  it("clears the session on logout", () => {
    const result = loginAsDemoUser("u-amy", storage, now);
    expect(result.ok).toBe(true);

    logout(storage);

    expect(getStoredSession(storage)).toBeNull();
  });

  it("ignores corrupt stored session data", () => {
    storage.setItem(AUTH_SESSION_STORAGE_KEY, "{not valid json");

    expect(getStoredSession(storage)).toBeNull();
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("checks admin permissions by role", () => {
    const admin = demoUsers.find((user) => user.role === "Admin")!;
    const staff = demoUsers.find((user) => user.role === "Staff")!;

    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(staff)).toBe(false);
  });

  it("returns false when no user is provided", () => {
    expect(isAdmin()).toBe(false);
  });

  it("clears stored session data explicitly", () => {
    const result = loginAsDemoUser("u-amy", storage, now);
    expect(result.ok).toBe(true);

    clearStoredSession(storage);

    expect(storage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("handles unavailable browser storage without throwing", () => {
    const throwingStorage = new ThrowingStorage();

    expect(getStoredSession(throwingStorage)).toBeNull();
    expect(() =>
      loginWithCredentials("admin@kossilon.test", "admin-demo", throwingStorage, now),
    ).not.toThrow();
    expect(() => logout(throwingStorage)).not.toThrow();
    expect(() => clearStoredSession(throwingStorage)).not.toThrow();
  });
});
