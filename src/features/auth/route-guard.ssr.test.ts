import { describe, expect, it } from "vitest";

import { isPublicRoute, isServerRenderable } from "./route-guard";

describe("isServerRenderable", () => {
  it("renders the public documents and the login shells on the server", () => {
    for (const pathname of [
      "/",
      "/en",
      "/login",
      "/en/login",
      "/request-access",
      "/en/request-access",
    ]) {
      expect(isServerRenderable(pathname)).toBe(true);
    }
  });

  it("keeps every authenticated route client-only", () => {
    for (const pathname of ["/dashboard", "/today", "/clients", "/portal", "/admin"]) {
      expect(isServerRenderable(pathname)).toBe(false);
      expect(isPublicRoute(pathname)).toBe(false);
    }
  });
});
