import { describe, expect, it } from "vitest";

import { authMethodsFor } from "./auth-methods";

describe("authMethodsFor", () => {
  it("keeps today's UI when the flag is unset or empty", () => {
    for (const raw of [undefined, "", "   "]) {
      expect(authMethodsFor(raw)).toEqual({ password: true, magicLink: true, google: true });
    }
  });

  it("reads an explicit comma-separated list", () => {
    expect(authMethodsFor("password,magic-link")).toEqual({
      password: true,
      magicLink: true,
      google: false,
    });
    expect(authMethodsFor("password")).toEqual({
      password: true,
      magicLink: false,
      google: false,
    });
    expect(authMethodsFor(" magic-link , google ")).toEqual({
      password: true,
      magicLink: true,
      google: true,
    });
  });

  it("keeps the default set for an unrecognised value instead of locking everyone out", () => {
    expect(authMethodsFor("typo")).toEqual({ password: true, magicLink: true, google: true });
  });

  it("never disables the password form", () => {
    expect(authMethodsFor("magic-link").password).toBe(true);
    expect(authMethodsFor("google").password).toBe(true);
  });
});
