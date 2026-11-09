import { describe, expect, it } from "vitest";

import { assertRequestAccessReviewer } from "./server-fns";

describe("request-access review authorization", () => {
  it("allows an Admin", () => {
    expect(() => assertRequestAccessReviewer({ role: "Admin" })).not.toThrow();
  });

  it("refuses Manager, Staff and Client with a Forbidden error", () => {
    for (const role of ["Manager", "Staff", "Client"] as const) {
      expect(() => assertRequestAccessReviewer({ role })).toThrow(/^Forbidden:/);
    }
  });
});
