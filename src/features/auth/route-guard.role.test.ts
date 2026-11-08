import { describe, expect, it } from "vitest";

import { isClientOnlyRoute, roleHomePath } from "./route-guard";

describe("role-safe entry", () => {
  it("sends each actor to the landing screen it can actually use", () => {
    expect(roleHomePath("Client")).toBe("/portal");
    expect(roleHomePath("Staff")).toBe("/today");
    expect(roleHomePath("Manager")).toBe("/today");
    expect(roleHomePath("Admin")).toBe("/today");
  });

  it("treats only the portal as client-only", () => {
    expect(isClientOnlyRoute("/portal")).toBe(true);
    // Staff use these too, so they must not trigger the staff-side redirect.
    for (const pathname of ["/documents", "/today", "/clients", "/annual-returns/abc"]) {
      expect(isClientOnlyRoute(pathname)).toBe(false);
    }
  });
});
