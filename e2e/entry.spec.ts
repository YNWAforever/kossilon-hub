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
  await expect(page.getByLabel("密碼")).toHaveAttribute("type", "password");

  // Show/hide is an accessible, pressed-state toggle, not a second password field.
  await page.getByRole("button", { name: "顯示密碼" }).click();
  await expect(page.getByLabel("密碼")).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "隱藏密碼" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "隱藏密碼" }).click();
  await expect(page.getByLabel("密碼")).toHaveAttribute("type", "password");

  // Invite-only: the sign-in screen routes to the request-access page.
  await page.getByRole("link", { name: "申請邀請" }).click();
  await expect(page).toHaveURL(/\/request-access$/);
  await expect(page.getByRole("heading", { name: "申請工作空間開通" })).toBeVisible();
  await expect(page.getByRole("link", { name: "電郵公司管理員" })).toHaveAttribute(
    "href",
    /^mailto:/,
  );
  // Until migration 0083 is applied this page must show the honest fallback,
  // never a form that cannot persist.
  await expect(page.getByLabel("姓名")).toHaveCount(0);
  await expect(page.getByText("管理員會審核申請。")).toHaveCount(0);

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
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByRole("button", { name: "Hide password" })).toBeVisible();

  await page.getByRole("link", { name: "Request access" }).click();
  await expect(page).toHaveURL(/\/en\/request-access$/);
  await expect(page.getByRole("heading", { name: "Request workspace access" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Email the administrator" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveCount(0);
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
