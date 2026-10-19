import { test, expect } from "@playwright/test";
import { assertAuditPersona, DEMO_STAFF_LANDING } from "./audit-persona";

test("LOCAL demo rejects a Staff session labelled as Admin despite the same dashboard landing", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Mei Lam/ }).click();
  await expect(page).toHaveURL(DEMO_STAFF_LANDING.url);
  await expect(assertAuditPersona(page, "ADMIN", 1000, DEMO_STAFF_LANDING)).rejects.toThrow(
    /persona/,
  );
  await assertAuditPersona(page, "STAFF", 5000, DEMO_STAFF_LANDING);
});
