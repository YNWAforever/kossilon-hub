import { describe, expect, it } from "vitest";

import { magicLinkCallback, peekRedirectPath, rememberRedirectPath } from "./route-guard";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("magic-link redirect handling", () => {
  it("carries a safe deep link through the callback URL", () => {
    expect(magicLinkCallback("https://example.test", "/clients?page=2")).toBe(
      "https://example.test/login?redirect=%2Fclients%3Fpage%3D2",
    );
  });

  it("drops unsafe, self-authentication and root targets", () => {
    for (const target of ["//evil.test", "/login", "/login?redirect=/x", "/", null, undefined]) {
      expect(magicLinkCallback("https://example.test", target)).toBe("https://example.test/login");
    }
  });

  it("peeks at the remembered target without consuming it", () => {
    const storage = memoryStorage();
    rememberRedirectPath("/clients", storage);

    expect(peekRedirectPath(storage)).toBe("/clients");
    expect(peekRedirectPath(storage)).toBe("/clients");
  });

  it("returns the role fallback for a root memory and undefined for empty or unavailable storage", () => {
    const storage = memoryStorage();
    expect(peekRedirectPath(storage)).toBeUndefined();

    // `getSafeRedirectPath("/")` is the post-login role fallback on this build.
    rememberRedirectPath("/", storage);
    expect(peekRedirectPath(storage)).toBe("/dashboard");
    expect(peekRedirectPath(null)).toBeUndefined();
  });
});
