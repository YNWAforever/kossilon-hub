import { describe, expect, it } from "vitest";

import { roleHomePath } from "./route-guard";

describe("role-safe entry", () => {
  it("sends each actor to the landing screen it can actually use", () => {
    expect(roleHomePath("Client")).toBe("/portal");
    expect(roleHomePath("Staff")).toBe("/today");
    expect(roleHomePath("Manager")).toBe("/today");
    expect(roleHomePath("Admin")).toBe("/today");
  });
});
