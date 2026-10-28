import { test as base, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  COMPANY,
  CASE_PATH,
  PERSONAS,
  activate,
  assertKeyboardFocus,
  assertReadonlyDelta,
  assertReadable,
  assertReflow,
  openNavigation,
  tabTo,
} from "./read-only-demo-journey";

const test = base.extend<{ demoPage: Page }>({
  demoPage: async ({ playwright }, providePage, info) => {
    const profile = info.outputPath("owned-profile");
    await mkdir(join(profile, "Default"), { recursive: true });
    // Chromium's default storage partition has an empty relative path -> key x.
    // A real persisted browser preference, not CSS zoom, pinch or CDP metrics.
    const zoom = Number(info.project.metadata.zoom);
    const preferences = {
      partition: { default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) } },
    };
    await writeFile(join(profile, "Default", "Preferences"), JSON.stringify(preferences), {
      flag: "wx",
    });
    const context = await playwright.chromium.launchPersistentContext(profile, {
      channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge",
      headless: true,
      viewport: info.project.name === "full390" ? { width: 390, height: 844 } : null,
      // Fixed physical window and OS scaling in both desktop control and 200%.
      args: ["--window-size=1304,992", "--force-device-scale-factor=1"],
      serviceWorkers: "block",
    });
    try {
      await providePage(context.pages()[0]);
    } finally {
      await context.close();
    }
  },
});

test("LOCAL R22 fixed viewport: keyboard demo boundary, case, reload, return and role denial", async ({
  demoPage: page,
}, info) => {
  test.setTimeout(120_000);
  const origin = String(info.project.use.baseURL);
  expect(new URL(origin).origin).toBe("http://127.0.0.1:5180");
  const width = Number(info.project.metadata.cssWidth);
  const height = Number(info.project.metadata.cssHeight);
  const zoom = Number(info.project.metadata.zoom);
  const denied: string[] = [];
  const pageErrors: string[] = [];
  const checkpoints: unknown[] = [];
  const requests: { method: string; path: string }[] = [];
  const cdp = await page.context().newCDPSession(page);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) {
      denied.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    requests.push({ method: request.method(), path: url.pathname });
    await route.continue();
  });
  await page.context().routeWebSocket("**/*", (socket) => {
    const target = new URL(socket.url());
    if (target.hostname === "127.0.0.1" && target.port === "5180") socket.connectToServer();
    else {
      denied.push(`WS ${target.origin}${target.pathname}`);
      socket.close();
    }
  });
  async function checkpoint(name: string) {
    await assertReflow(page, width);
    const metrics = await page.evaluate(() => ({
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
      devicePixelRatio,
      visualScale: visualViewport!.scale,
      visualWidth: visualViewport!.width,
      rootZoom: getComputedStyle(document.documentElement).zoom,
      bodyZoom: getComputedStyle(document.body).zoom,
      rootTransform: getComputedStyle(document.documentElement).transform,
      bodyTransform: getComputedStyle(document.body).transform,
    }));
    const layout = await cdp.send("Page.getLayoutMetrics");
    checkpoints.push({
      name,
      path: new URL(page.url()).pathname,
      metrics,
      cssVisualViewport: layout.cssVisualViewport,
    });
    expect(layout.cssVisualViewport.zoom, "direct browser page-zoom reading").toBe(zoom);
    expect(layout.cssVisualViewport.scale, "pinch scale stays at 100%").toBe(1);
    expect(metrics.innerWidth).toBe(width);
    expect(metrics.innerHeight).toBe(height);
    expect(metrics.devicePixelRatio).toBe(zoom);
    expect(metrics.visualScale).toBe(1);
    expect(metrics.visualWidth).toBe(width);
    expect(metrics.rootZoom).toBe("1");
    expect(metrics.bodyZoom).toBe("1");
    expect(metrics.rootTransform).toBe("none");
    expect(metrics.bodyTransform).toBe("none");
    if (info.project.name !== "full390") {
      expect(metrics.outerWidth).toBe(1304);
      expect(metrics.outerHeight).toBe(992);
      expect(page.viewportSize(), "desktop uses native window; no viewport override").toBeNull();
    } else expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    // Playwright's fullPage clip uses CSS dimensions even when native page
    // zoom is 200%, cropping the physical surface. Capture that surface with
    // CDP, assert its PNG dimensions, and keep a separately scaled full page.
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const pixels = Buffer.from(shot.data, "base64");
    expect(pixels.readUInt32BE(16)).toBe(width * zoom);
    expect(pixels.readUInt32BE(20)).toBe(height * zoom);
    await writeFile(info.outputPath(`${name}.png`), pixels, { flag: "wx" });
    if (name.endsWith("-case") || name.endsWith("-reload")) {
      const full = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: layout.cssContentSize.width * zoom,
          height: layout.cssContentSize.height * zoom,
          scale: 1,
        },
      });
      const fullPixels = Buffer.from(full.data, "base64");
      expect(fullPixels.readUInt32BE(16)).toBe(width * zoom);
      await writeFile(info.outputPath(`${name}-full.png`), fullPixels, { flag: "wx" });
    }
  }
  try {
    for (const persona of PERSONAS) {
      await page.goto(`${origin}/login?redirect=%2F`);
      await activate(page, page.getByRole("button", { name: new RegExp(persona.name) }));
      await expect(
        page.getByRole("heading", { level: 1, name: "總覽", exact: true }),
      ).toBeVisible();
      await checkpoint(`${persona.role}-overview`);
      const nav = await openNavigation(page);
      const account = page.getByRole("button", { name: "登出", exact: true }).locator("..");
      await expect(account.getByText(persona.name, { exact: true })).toBeVisible();
      await expect(account.getByText(persona.label, { exact: true })).toBeVisible();
      for (const label of ["用戶管理", "設定", "月表匯入"]) {
        await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(
          persona.role === "Admin" ? 1 : 0,
        );
      }
      await activate(page, nav.getByRole("link", { name: "客戶", exact: true }));
      await expect(page).toHaveURL((url) => url.pathname === "/clients");
      const main = page.getByRole("main");
      await expect(main.getByRole("region", { name: "示範模式未提供" })).toContainText(
        "客戶名冊讀取實時公司紀錄，並無示範資料。請登入正式環境使用。",
      );
      await expect(main.getByRole("table")).toHaveCount(0);
      await expect(main.locator('a[href^="/clients/"]')).toHaveCount(0);
      await checkpoint(`${persona.role}-client-unavailable`);

      const trigger = page.getByRole("button", { name: "開啟導覽選單", exact: true });
      if (await trigger.isVisible()) {
        const drawer = await openNavigation(page);
        const dialog = page.getByRole("dialog", { name: "導覽", exact: true });
        await expect(drawer).toBeVisible();
        const focusOrder = () =>
          dialog.evaluate((element) => {
            const stops = Array.from(
              element.querySelectorAll<HTMLElement>(
                "a[href], button, select, input, textarea, [tabindex]",
              ),
            ).filter(
              (node) =>
                node.tabIndex >= 0 &&
                !node.matches(":disabled") &&
                node.getClientRects().length > 0,
            );
            return {
              count: stops.length,
              active: stops.indexOf(document.activeElement as HTMLElement),
            };
          });
        let current = await focusOrder();
        expect(current.count).toBeGreaterThan(5);
        expect(current.active).toBeGreaterThanOrEqual(0);
        for (const direction of ["Tab", "Shift+Tab"]) {
          const count = current.count;
          for (let i = 0; i < count + 2; i++) {
            await page.keyboard.press(direction);
            const next = await focusOrder();
            expect(next).toEqual({
              count,
              active: (current.active + (direction === "Tab" ? 1 : -1) + count) % count,
            });
            current = next;
          }
        }
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        await assertKeyboardFocus(trigger);
      }

      // Existing DemoUnavailable fallback; explicitly not a client-record journey.
      await activate(page, main.getByRole("link", { name: "瀏覽周年申報案件", exact: true }));
      await expect(page).toHaveURL(/\/annual-returns$/);
      const search = page.getByRole("textbox", { name: "搜尋公司或聯絡人" });
      await tabTo(page, search);
      await page.keyboard.type("R22 no such synthetic company");
      await expect(main.locator('a[href^="/annual-returns/"]')).toHaveCount(0);
      await checkpoint(`${persona.role}-empty-search`);
      await search.press("Control+A");
      await page.keyboard.type("Delta Bloom");
      const openCase = page.getByRole("link", { name: `開啟 ${COMPANY}`, exact: true });
      await expect(openCase).toHaveAttribute("href", CASE_PATH);
      await expect(main.locator('a[href^="/annual-returns/"]')).toHaveCount(1);
      await checkpoint(`${persona.role}-filtered-board`);
      await activate(page, openCase);
      const before = await assertReadonlyDelta(page);
      for (const target of [
        main.getByRole("heading", { level: 1, name: COMPANY, exact: true }),
        main.getByRole("combobox", { name: "分配負責同事" }),
        main.getByRole("combobox", { name: "付款", exact: true }),
        main.getByRole("button", { name: "遞交交件套件", exact: true }),
        main.getByRole("button", { name: "接納回條", exact: true }),
        main.getByRole("textbox", { name: "新增備註", exact: true }),
        main.getByRole("link", { name: "返回", exact: true }),
      ])
        await assertReadable(target);
      await checkpoint(`${persona.role}-case`);
      const note = page.getByRole("textbox", { name: "新增備註", exact: true });
      await tabTo(page, note);
      await page.keyboard.type("R22 read-only probe");
      await expect(note).toHaveValue("");
      await page.reload();
      expect(await assertReadonlyDelta(page)).toEqual(before);
      await checkpoint(`${persona.role}-reload`);
      const back = main.getByRole("link", { name: "返回", exact: true });
      await expect(back).toHaveAttribute("href", "/annual-returns");
      await activate(page, back);
      await expect(page).toHaveURL(/\/annual-returns$/);
      await expect(search).toHaveValue("");
      await expect(openCase).toBeVisible();
      await checkpoint(`${persona.role}-return`);

      if (persona.role === "Admin") {
        const adminNav = await openNavigation(page);
        await activate(page, adminNav.getByRole("link", { name: "用戶管理", exact: true }));
        const amy = page.getByRole("row").filter({ hasText: "Amy Chan" });
        await expect(amy.getByRole("combobox", { name: "Amy Chan 的角色" })).toBeDisabled();
        await expect(
          amy.getByRole("button", { name: "停用 Amy Chan", exact: true }),
        ).toBeDisabled();
        await checkpoint("Admin-read-only-users");
      } else {
        await page.goto(`${origin}/admin`);
        await expect(
          page.getByRole("heading", { name: "須具備管理員權限", exact: true }),
        ).toBeVisible();
        await expect(main.getByRole("table")).toHaveCount(0);
        await expect(main.getByRole("button")).toHaveCount(0);
        await checkpoint("Staff-direct-route-denial");
        await activate(page, main.getByRole("link", { name: "返回總覽", exact: true }));
      }
      await openNavigation(page);
      await activate(page, page.getByRole("button", { name: "登出", exact: true }));
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
    }
    expect(pageErrors).toEqual([]);
    expect(denied, "no external browser request or write").toEqual([]);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  } finally {
    await writeFile(
      info.outputPath("journey-facts.json"),
      JSON.stringify(
        {
          project: info.project.name,
          zoom,
          width,
          height,
          checkpoints,
          requests,
          denied,
          pageErrors,
          browser: page.context().browser()?.version(),
          nativeAuth: false,
          businessWrites: false,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
  }
});
