import { beforeEach, describe, expect, it } from "vitest";
import {
  isClientRoute,
  AUTH_REDIRECT_STORAGE_KEY,
  consumeRedirectPath,
  isPublicRoute,
  rememberRedirectPath,
  isDemoAuthEnabled,
  getSafeRedirectPath,
  isForbiddenAuthError,
} from "./route-guard";

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

describe("auth route guard helpers", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("treats only login as public", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/")).toBe(false);
    expect(isPublicRoute("/admin")).toBe(false);
    expect(isPublicRoute("/login/help")).toBe(false);
  });

  it("keeps demo auth disabled unless explicitly enabled", () => {
    expect(isDemoAuthEnabled(undefined)).toBe(false);
    expect(isDemoAuthEnabled("false")).toBe(false);
    expect(isDemoAuthEnabled("true")).toBe(true);
    expect(isDemoAuthEnabled("true", true)).toBe(false);
  });

  it("remembers and consumes a safe redirect path", () => {
    rememberRedirectPath("/annual-returns?risk=red", storage);

    expect(storage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBe("/annual-returns?risk=red");
    expect(consumeRedirectPath(storage)).toBe("/annual-returns?risk=red");
    expect(storage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it("normalizes unsafe redirect paths to dashboard", () => {
    for (const unsafePath of [
      "https://example.com/phish",
      "http://example.com/phish",
      "//example.com/phish",
      "annual-returns",
      "",
      "/login",
      "/login?next=/admin",
      "/login#expired",
    ]) {
      rememberRedirectPath(unsafePath, storage);

      expect(consumeRedirectPath(storage)).toBe("/");
      expect(storage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBeNull();
    }
  });

  it("returns safe redirect paths for URL search redirects", () => {
    expect(getSafeRedirectPath("/admin")).toBe("/admin");
    expect(getSafeRedirectPath("/annual-returns?risk=red")).toBe("/annual-returns?risk=red");
    expect(getSafeRedirectPath("/login?redirect=/admin")).toBe("/");
    expect(getSafeRedirectPath("https://example.com/phish")).toBe("/");
  });

  // startsWith("//") alone was not enough. Browsers normalise backslashes to
  // forward slashes when parsing a URL and strip control characters before
  // parsing, so each of these reassembles into a protocol-relative authority.
  it("rejects authority forms that only appear after URL normalisation", () => {
    for (const path of [
      "/\\evil.com",
      "/\\/evil.com",
      "/\\\\evil.com",
      "/\tevil.com",
      "/\nevil.com",
      "/\revil.com",
      "/\u0000//evil.com",
      "/\u007f/evil.com",
    ]) {
      expect(getSafeRedirectPath(path), `${JSON.stringify(path)} should not be trusted`).toBe("/");
    }
  });

  it("still allows ordinary in-app paths", () => {
    expect(getSafeRedirectPath("/annual-returns/9f0c2e1a-0000-4000-8000-000000000001")).toBe(
      "/annual-returns/9f0c2e1a-0000-4000-8000-000000000001",
    );
    expect(getSafeRedirectPath("/documents#section")).toBe("/documents#section");
  });

  it("normalizes empty stored redirects when consuming", () => {
    storage.setItem(AUTH_REDIRECT_STORAGE_KEY, "");

    expect(consumeRedirectPath(storage)).toBe("/");
    expect(storage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it("is safe to call without browser storage", () => {
    expect(() => rememberRedirectPath("/admin")).not.toThrow();
    expect(consumeRedirectPath()).toBe("/");
  });

  it("falls back safely when storage operations fail", () => {
    const throwingStorage = new ThrowingStorage();

    expect(() => rememberRedirectPath("/admin", throwingStorage)).not.toThrow();
    expect(consumeRedirectPath(throwingStorage)).toBe("/");
  });
});

/**
 * A Client sign-in used to land on the staff dashboard, which resolves a staff
 * actor on every query it makes — so the first thing a client saw after signing
 * in was a screen of Forbidden errors.
 */
describe("isClientRoute", () => {
  it("allows the two surfaces built for client actors", () => {
    expect(isClientRoute("/portal")).toBe(true);
    expect(isClientRoute("/documents")).toBe(true);
  });

  it("allows nested paths under them", () => {
    expect(isClientRoute("/portal/anything")).toBe(true);
  });

  it("refuses every staff surface", () => {
    for (const pathname of [
      "/",
      "/admin",
      "/annual-returns",
      "/annual-returns/9f0c2e1a-0000-4000-8000-000000000001",
      "/work-queue",
      "/payments",
      "/whatsapp",
      "/settings",
    ]) {
      expect(isClientRoute(pathname), `${pathname} should not be a client route`).toBe(false);
    }
  });

  // A prefix match must not let /portal-admin through on the strength of /portal.
  it("does not match a path that merely starts with the same characters", () => {
    expect(isClientRoute("/portalx")).toBe(false);
    expect(isClientRoute("/documents-internal")).toBe(false);
  });
});

describe("isForbiddenAuthError", () => {
  it("recognizes a Forbidden-prefixed error", () => {
    expect(isForbiddenAuthError(new Error("Forbidden: user is not provisioned."))).toBe(true);
  });

  it("does not treat Unauthorized as Forbidden", () => {
    expect(isForbiddenAuthError(new Error("Unauthorized: a session is required."))).toBe(false);
  });

  it("fails closed on anything that is not an Error with the prefix", () => {
    expect(isForbiddenAuthError("Forbidden: not an Error instance")).toBe(false);
    expect(isForbiddenAuthError(null)).toBe(false);
    expect(isForbiddenAuthError(undefined)).toBe(false);
    expect(isForbiddenAuthError(new Error("some other failure"))).toBe(false);
  });
});
