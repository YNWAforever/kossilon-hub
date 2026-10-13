import { describe, expect, it } from "vitest";

import { roleLabel } from "./role-labels";

describe("roleLabel", () => {
  it("shows roles in Chinese and keeps unknown or missing values readable", () => {
    expect(roleLabel("Admin")).toBe("管理員");
    expect(roleLabel("Staff")).toBe("同事");
    expect(roleLabel("Auditor")).toBe("Auditor");
    expect(roleLabel(undefined)).toBe("用戶");
  });
});
