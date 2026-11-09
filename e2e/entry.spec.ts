import { expect, test } from "@playwright/test";

/**
 * Critical entry journeys for the read-only local demo.
 *
 * Production-mode Google/magic-link UI needs real Neon Auth methods, so those
 * branches stay covered by the component interaction tests; this runner proves
 * the browser-visible entry surface, the password field affordance, the
 * request-access fallback and the demo identity path.
 */
test("entry surfaces are usable at 390 and 1280", async ({ page }, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登入工作空間" })).toBeVisible();
  await expect(page.getByLabel("電郵")).toBeVisible();
  const password = page.locator("#login-password");
  await expect(password).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "顯示密碼" })).toBeVisible();

  // The demo login hides the invite-only footer link, so enter the public page
  // directly. Migration 0083 is applied, so the persisted form is the live state;
  // the mailto fallback is still accepted where the table is absent.
  await page.goto("/request-access");
  const requestName = page.getByLabel("姓名");
  const adminEmail = page.getByRole("link", { name: "電郵公司管理員" });
  // Migration 0083 is applied, so CI renders the persisted form; the fallback is
  // still accepted by the same journey for environments where the table is absent.
  await expect(requestName.or(adminEmail)).toBeVisible();
  if (await requestName.isVisible()) {
    await expect(page.getByLabel("工作電郵")).toBeVisible();
    await expect(page.getByRole("checkbox")).toBeVisible();
  } else {
    await expect(adminEmail).toHaveAttribute("href", /^mailto:/);
  }

  // Deep-linkable back link, no client-side dead end.
  await page.getByRole("link", { name: "返回 ComSec OS" }).click();
  await expect(page).toHaveURL(/\/$/);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("entry-zh-HK.png"), fullPage: true });
  expect(pageErrors).toEqual([]);
});

test("English entry mirrors the journey", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/en/login");
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show password" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();

  await page.goto("/en/request-access");
  await expect(page).toHaveURL(/\/en\/request-access$/);
  await expect(page.getByRole("heading", { name: "Request workspace access" })).toBeVisible();
  const requestName = page.getByLabel("Name");
  const adminEmail = page.getByRole("link", { name: "Email the administrator" });
  await expect(requestName.or(adminEmail)).toBeVisible();
  if (await requestName.isVisible()) {
    await expect(page.getByLabel("Work email")).toBeVisible();
  } else {
    await expect(adminEmail).toBeVisible();
  }
  await page.getByRole("link", { name: "Back to ComSec OS" }).click();
  await expect(page).toHaveURL(/\/en$/);

  expect(pageErrors).toEqual([]);
});

test("a demo identity still enters the fixture dashboard and can sign out", async ({
  page,
}, info) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Amy Chan/ }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "總覽", exact: true })).toBeVisible();

  // Sign-out lives in the sidebar, which is a drawer on mobile.
  if (info.project.name === "mobile390")
    await page.getByRole("button", { name: "開啟導覽選單" }).click();
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("button", { name: /Amy Chan/ })).toBeVisible();
});
