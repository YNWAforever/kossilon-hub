import { test, expect } from "@playwright/test";
import {
  COMPANY,
  CASE_PATH,
  PERSONAS,
  assertKeyboardFocus,
  tabTo,
  activate,
  openNavigation,
  assertReflow,
  assertReadonlyDelta,
} from "./read-only-demo-journey";

// Reflow simulation only; actual browser zoom has a separate guarded runner.
const REFLOW = { width: 640, height: 450 };

test("LOCAL R22: keyboard demo boundaries, seeded annual-return reload/return and 640 CSS px reflow", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const initialViewport = page.viewportSize();
  expect(initialViewport).not.toBeNull();
  const base = new URL(String(info.project.use.baseURL));
  expect(base.protocol).toBe("http:");
  expect(["127.0.0.1", "localhost"]).toContain(base.hostname);
  expect(base.port).toBe("5180");
  const blockedRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Abort unexpected browser requests, never fulfil/mock a production response.
  // This cannot establish server-side DB isolation; the parent owns that gate.
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base.origin || !["GET", "HEAD"].includes(request.method())) {
      blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  info.annotations.push({
    type: "scope",
    description:
      "Local demo only; client record journey unavailable; 640 CSS px is reflow, not actual 200% zoom or native Auth.",
  });

  for (const persona of PERSONAS) {
    await test.step(`${persona.role}: keyboard login and honest client demo boundary`, async () => {
      await page.setViewportSize(initialViewport!);
      // Explicit existing redirect avoids inheriting the prior persona's
      // remembered deep link when this single test signs out and changes role.
      await page.goto("/login?redirect=%2F", { waitUntil: "networkidle" });
      await activate(page, page.getByRole("button", { name: new RegExp(persona.name) }));
      await expect(
        page.getByRole("heading", { level: 1, name: "總覽", exact: true }),
      ).toBeVisible();
      const nav = await openNavigation(page);
      const account = page.getByRole("button", { name: "登出", exact: true }).locator("..");
      await expect(account.getByText(persona.name, { exact: true })).toBeVisible();
      await expect(account.getByText(persona.label, { exact: true })).toBeVisible();
      for (const name of ["用戶管理", "設定", "月表匯入"]) {
        await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(
          persona.role === "Admin" ? 1 : 0,
        );
      }
      await activate(page, nav.getByRole("link", { name: "客戶", exact: true }));
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === "/clients" &&
          url.searchParams.get("q") === "" &&
          url.searchParams.get("status") === "all" &&
          url.searchParams.get("team") === "all" &&
          url.searchParams.get("includeFixtures") === "false" &&
          !url.searchParams.has("cursor"),
      );
      await expect(
        page.getByRole("heading", { level: 1, name: "客戶", exact: true }),
      ).toBeVisible();
      const main = page.getByRole("main");
      await expect(main.getByRole("region", { name: "示範模式未提供" })).toContainText(
        "客戶名冊讀取實時公司紀錄，並無示範資料。請登入正式環境使用。",
      );
      await expect(main.getByRole("table")).toHaveCount(0);
      await expect(main.locator('a[href^="/clients/"]')).toHaveCount(0);
      await assertReflow(page, initialViewport!.width);
      await page.setViewportSize(REFLOW);
      await assertReflow(page, REFLOW.width);

      const trigger = page.getByRole("button", { name: "開啟導覽選單", exact: true });
      const drawerNav = await openNavigation(page);
      const dialog = page.getByRole("dialog", { name: "導覽", exact: true });
      // More than one complete cycle: links + sign-out + close, including wrap.
      const tabCount = (await drawerNav.getByRole("link").count()) + 4;
      for (let index = 0; index < tabCount; index++) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await assertKeyboardFocus(trigger);
      await page.screenshot({
        path: info.outputPath(`${persona.role}-clients-640.png`),
        fullPage: true,
      });
    });

    await test.step(`${persona.role}: real fixture board -> detail -> read-only reload -> return`, async () => {
      // This is DemoUnavailable's existing fallback, NOT a client-record link.
      await activate(page, page.getByRole("link", { name: "瀏覽周年申報案件", exact: true }));
      await expect(page).toHaveURL(/\/annual-returns$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "周年申報", exact: true }),
      ).toBeVisible();
      const search = page.getByRole("textbox", { name: "搜尋公司或聯絡人" });
      await tabTo(page, search);
      await page.keyboard.type("Delta Bloom");
      const openCase = page.getByRole("link", { name: `開啟 ${COMPANY}`, exact: true });
      await expect(openCase).toHaveAttribute("href", CASE_PATH);
      const row = openCase.locator("../..");
      await expect(row).toContainText(COMPANY);
      await expect(row).toContainText("Joanna Poon");
      await expect(row).toContainText("Iris Wong");
      await expect(row).toContainText("付款：待付款");
      await expect(page.getByRole("main").locator('a[href^="/annual-returns/"]')).toHaveCount(1);
      await assertReflow(page, REFLOW.width);
      await activate(page, openCase);
      const beforeReload = await assertReadonlyDelta(page);
      await assertReflow(page, REFLOW.width);
      const note = page.getByRole("textbox", { name: "新增備註", exact: true });
      await tabTo(page, note);
      await page.keyboard.type("R22 read-only probe");
      await expect(note).toHaveValue("");
      await page.screenshot({
        path: info.outputPath(`${persona.role}-case-640.png`),
        fullPage: true,
      });
      // Local Vite continues loading route modules after the window load event.
      // Keep the existing UI assertions after those requests have settled.
      await page.reload({ waitUntil: "networkidle" });
      expect(await assertReadonlyDelta(page)).toEqual(beforeReload);
      await assertReflow(page, REFLOW.width);
      await page.screenshot({
        path: info.outputPath(`${persona.role}-reload-640.png`),
        fullPage: true,
      });
      const back = page.getByRole("main").getByRole("link", { name: "返回", exact: true });
      await expect(back).toHaveAttribute("href", "/annual-returns");
      await activate(page, back);
      await expect(page).toHaveURL(/\/annual-returns$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "周年申報", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "搜尋公司或聯絡人" })).toHaveValue("");
      await expect(openCase).toBeVisible();
      await expect(row).toContainText("Joanna Poon");
      await expect(row).toContainText("付款：待付款");
      await assertReflow(page, REFLOW.width);
    });

    await test.step(`${persona.role}: Admin read-only surface or Staff direct-route denial`, async () => {
      if (persona.role === "Admin") {
        const nav = await openNavigation(page);
        await activate(page, nav.getByRole("link", { name: "用戶管理", exact: true }));
        await expect(page).toHaveURL(/\/admin$/);
        await expect(
          page.getByRole("heading", { level: 1, name: "用戶管理", exact: true }),
        ).toBeVisible();
        const amy = page.getByRole("row").filter({ hasText: "Amy Chan" });
        await expect(amy.getByRole("combobox", { name: "Amy Chan 的角色" })).toHaveValue("Admin");
        await expect(amy.getByRole("combobox", { name: "Amy Chan 的角色" })).toBeDisabled();
        await expect(
          amy.getByRole("button", { name: "停用 Amy Chan", exact: true }),
        ).toBeDisabled();
      } else {
        await page.goto("/admin");
        await expect(page).toHaveURL(/\/admin$/);
        await expect(
          page.getByRole("heading", { name: "須具備管理員權限", exact: true }),
        ).toBeVisible();
        const main = page.getByRole("main");
        await expect(main).toContainText("Mei Lam目前以「同事」身分登入。");
        await expect(main.getByRole("table")).toHaveCount(0);
        await expect(main.getByRole("combobox")).toHaveCount(0);
        await expect(main.getByRole("button")).toHaveCount(0);
        await assertReflow(page, REFLOW.width);
        await page.screenshot({
          path: info.outputPath("Staff-denial-640.png"),
          fullPage: true,
        });
        await activate(page, main.getByRole("link", { name: "返回總覽", exact: true }));
        await expect(
          page.getByRole("heading", { level: 1, name: "總覽", exact: true }),
        ).toBeVisible();
      }
      await assertReflow(page, REFLOW.width);
      await openNavigation(page);
      await activate(page, page.getByRole("button", { name: "登出", exact: true }));
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
    });
  }
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(blockedRequests, "no external request or browser write is permitted").toEqual([]);
});
