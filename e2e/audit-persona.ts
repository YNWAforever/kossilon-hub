import { expect, type Page } from "@playwright/test";
import { AUDIT_ACCOUNT_ROLES, type AuditAccount } from "../scripts/audit-staging-config";

/** Where a signed-in staff persona lands; the read-only demo starts on the dashboard. */
export type StaffLanding = { url: RegExp; heading: string };
export const PRODUCTION_STAFF_LANDING: StaffLanding = {
  url: /\/today(?:\?|$)/,
  heading: "今日工作",
};
export const DEMO_STAFF_LANDING: StaffLanding = { url: /\/(?:\?|$)/, heading: "Dashboard" };

/** Shared landing assertions; role evidence must come from the authenticated UI. */
export async function assertAuditPersona(
  page: Page,
  account: AuditAccount,
  timeout = 5000,
  staffLanding: StaffLanding = PRODUCTION_STAFF_LANDING,
) {
  const client = account.startsWith("CLIENT");
  await expect(page).toHaveURL(client ? /\/portal(?:\?|$)/ : staffLanding.url, { timeout });
  await expect(
    page.getByRole("heading", {
      name: client ? "Your annual returns" : staffLanding.heading,
      exact: true,
    }),
  ).toBeVisible({ timeout });
  const menu = page.getByRole("button", { name: "Open navigation menu", exact: true });
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  const opened = (await menu.isVisible()) && !(await signOut.isVisible());
  if (opened) await menu.click();
  try {
    // AccountBlock uses the root's server-derived authenticated session, never env role labels.
    await expect(
      signOut.locator("..").getByText(AUDIT_ACCOUNT_ROLES[account], { exact: true }),
    ).toBeVisible({ timeout });
  } catch {
    throw new Error(
      "Fresh controlled persona mismatch; Auth owner must verify account provisioning.",
    );
  } finally {
    if (opened) await page.keyboard.press("Escape");
  }
}
