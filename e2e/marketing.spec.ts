import { expect, test } from "@playwright/test";

test("anonymous marketing has server-rendered content, locales, working navigation and login CTA", async ({
  page,
  request,
}, info) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("ComSec OS");
  expect(html).toContain("讓每一宗公司秘書工作，都有清晰下一步。");
  expect(html).toContain('href="/login"');
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-HK");
  await expect(page).toHaveTitle(/ComSec OS/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "讓每一宗公司秘書工作，都有清晰下一步。",
  );
  await expect(page.getByRole("navigation", { name: "主要導覽" })).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "產品導覽" });
  if (info.project.name === "mobile390") {
    await page.getByText("選單", { exact: true }).click();
  }
  await nav.getByRole("link", { name: "使用流程" }).click();
  await expect(page.locator("#workflow")).toBeInViewport();
  await expect(page.locator("#pricing")).toContainText("TBC");
  await expect(page.locator("figcaption")).toContainText("合成示意");
  await page.locator("#faq summary").first().click();
  await expect(page.locator("#faq details").first()).toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("marketing-zh-HK.png"), fullPage: true });

  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A clear next step for every company secretarial case.",
  );
  await expect(page.locator("#pricing")).toContainText("TBC");
  await expect(page.locator("figcaption")).toContainText("Synthetic illustration");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: viewport.height });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.getByText("Menu", { exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByText("Menu", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Product navigation" })
    .getByRole("link", { name: "Features", exact: true })
    .click();
  await expect(page.locator("#features")).toBeInViewport();
  await page.setViewportSize(viewport);
  await page.screenshot({ path: info.outputPath("marketing-en.png"), fullPage: true });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("link", { name: "繁體中文", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  // Native locale links load a fresh document; allow its hydration and scroll
  // restoration to settle before Playwright scrolls back to the hero CTA.
  await page.waitForLoadState("networkidle");
  await page
    .locator(".comsec-hero")
    .getByRole("link", { name: /登入工作空間/ })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});

test("marketing works without JavaScript, including language, FAQ and login links", async ({
  browser,
  viewport,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "跳至內容" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#content")).toBeFocused();
    await page.locator("#faq summary").first().click();
    await expect(page.locator("#faq details").first()).toHaveAttribute("open", "");
    await page.getByRole("link", { name: "EN", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page
      .locator(".comsec-hero")
      .getByRole("link", { name: /Log in to workspace/ })
      .click();
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await context.close();
  }
});
