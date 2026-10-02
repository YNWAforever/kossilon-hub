import { test, expect } from "@playwright/test";
import { assertAuditPersona } from "./audit-persona";

test("LOCAL demo rejects a Staff session labelled as Admin despite the same Today landing", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Mei Lam/ }).click();
  await expect(page).toHaveURL(/\/today/);
  await expect(assertAuditPersona(page, "ADMIN", 1000)).rejects.toThrow(/persona/);
  await assertAuditPersona(page, "STAFF");
});
