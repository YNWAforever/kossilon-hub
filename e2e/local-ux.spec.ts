import { test, expect } from "@playwright/test";

/** Genuine browser/layout evidence on existing read-only demo. Never genuine Auth/provider UAT. */
test("Admin daily entry, all links, keyboard drawer, readable settings and touch targets", async ({
  page,
}, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/login");
  await page.getByRole("button", { name: /Amy Chan/ }).click();
  await expect(page).toHaveURL(/\/today/);
  await expect(page.getByRole("heading", { name: "今日工作", exact: true })).toBeVisible();
  const mobile = info.project.name === "mobile390",
    trigger = page.getByRole("button", { name: "Open navigation menu" });
  if (mobile) {
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
  }
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link")).toHaveCount(16);
  await expect(nav.getByRole("link", { name: "今日工作", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const sizes = await nav
    .getByRole("link")
    .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height));
  expect(sizes.every((height) => height >= 44)).toBe(true);
  await page.screenshot({
    path: `docs/audit-remediation/evidence/t20-${info.project.name}-navigation.png`,
    fullPage: true,
  });
  if (mobile) {
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
  }
  await nav.getByRole("link", { name: "設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByLabel("模板名稱")).toBeDisabled();
  await expect(page.getByRole("button", { name: "New template" })).toHaveCount(0);
  const rect = await page.getByLabel("模板名稱").boundingBox();
  expect(rect!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `docs/audit-remediation/evidence/t20-${info.project.name}-settings.png`,
    fullPage: true,
  });
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("Staff retains daily links while Admin settings/actions stay hidden", async ({
  page,
}, info) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Mei Lam/ }).click();
  await expect(page).toHaveURL(/\/today/);
  if (info.project.name === "mobile390")
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link", { name: "設定", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "用戶管理" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "系統運作" })).toBeVisible();
});
