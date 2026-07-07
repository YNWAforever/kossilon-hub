import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_REDIRECT_STORAGE_KEY,
  consumeRedirectPath,
  isPublicRoute,
  rememberRedirectPath,
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
