import { test, expect } from "@playwright/test";
import { assertAuditPersona } from "./audit-persona";

// Genuine fresh password sessions only when the strict staging config is supplied.
// Magic-link/Google and the50 complete business UAT require separate real evidence.
for (const account of ["ADMIN", "MANAGER", "STAFF", "CLIENT_A", "CLIENT_B"] as const) {
  test(`fresh controlled${account} signs in to its authorised landing`, async ({ page }) => {
    try {
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(process.env[`AUDIT_${account}_EMAIL`]!);
      await page
        .getByLabel("Password", { exact: true })
        .fill(process.env[`AUDIT_${account}_PASSWORD`]!);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    } catch {
      // Do not publish Playwright fill errors/traces containing credentials.
      throw new Error(
        "Fresh controlled sign-in failed; Auth owner must inspect secure runtime evidence.",
      );
    }
    await assertAuditPersona(page, account);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });
}
