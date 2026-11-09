import { expect, test } from "@playwright/test";

/**
 * Production browser smoke. Runs in CI (GitHub-hosted browsers) after the
 * deployment exists; it executes the real production bundle, which also
 * exercises the CSP reporter and proves the zod jitless bootstrap ran.
 */
test("production boots with the zod jitless bootstrap and no page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("https://kossilon-hub.vercel.app/", {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await expect(page.locator("h1").first()).toBeVisible();
  expect(await page.evaluate(() => globalThis.__zod_globalConfig?.jitless === true)).toBe(true);

  // Give the browser time to emit CSP reports for any remaining violation.
  await page.waitForTimeout(1_500);
  expect(errors).toEqual([]);
});
