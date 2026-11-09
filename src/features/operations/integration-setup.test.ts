import { describe, expect, it } from "vitest";

import { INTEGRATION_SETUP, setupRows } from "./integration-setup";

describe("integration setup catalog", () => {
  it("covers every capability the deployment reports", () => {
    expect(INTEGRATION_SETUP.map((item) => item.id)).toEqual([
      "firm",
      "database",
      "auth",
      "documents",
      "email",
      "whatsapp",
      "document-scanner",
      "scheduler",
    ]);
  });

  it("lists binding names only, never values", () => {
    const text = JSON.stringify(INTEGRATION_SETUP);
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("sk_");
    for (const item of INTEGRATION_SETUP) {
      expect(item.required.length).toBeGreaterThan(0);
      expect(item.secrets.every((name) => item.required.includes(name))).toBe(true);
    }
  });

  it("merges live configured/missing state and fails closed for unknown rows", () => {
    const rows = setupRows([
      { id: "firm", configured: true, missing: [] },
      { id: "email", configured: false, missing: ["EMAIL_FROM|RESEND_FROM"] },
    ]);

    expect(rows.find((row) => row.id === "firm")?.configured).toBe(true);
    expect(rows.find((row) => row.id === "email")?.missing).toEqual(["EMAIL_FROM|RESEND_FROM"]);
    // A capability the report omits is treated as unconfigured with its full binding list.
    expect(rows.find((row) => row.id === "whatsapp")?.configured).toBe(false);
    expect(rows.find((row) => row.id === "whatsapp")?.missing).toContain("WOZTELL_ACCESS_TOKEN");
  });
});
