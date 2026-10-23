# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: r22-viewport-zoom.spec.ts >> LOCAL R22 fixed viewport: keyboard demo boundary, case, reload, return and role denial
- Location: e2e\r22-viewport-zoom.spec.ts:47:1

# Error details

```
Error: tracing.start: Tracing has been already started
```

# Test source

```ts
  1   | import { test as base, expect, type Page } from "@playwright/test";
  2   | import { mkdir, writeFile } from "node:fs/promises";
  3   | import { join } from "node:path";
  4   | import {
  5   |   COMPANY,
  6   |   CASE_PATH,
  7   |   PERSONAS,
  8   |   activate,
  9   |   assertKeyboardFocus,
  10  |   assertReadonlyDelta,
  11  |   assertReflow,
  12  |   openNavigation,
  13  |   tabTo,
  14  | } from "./read-only-demo-journey";
  15  | 
  16  | const test = base.extend<{ demoPage: Page }>({
  17  |   demoPage: async ({ playwright }, use, info) => {
  18  |     const profile = info.outputPath("owned-profile");
  19  |     await mkdir(join(profile, "Default"), { recursive: true });
  20  |     // Chromium's default storage partition has an empty relative path -> key x.
  21  |     // A real persisted browser preference, not CSS zoom, pinch or CDP metrics.
  22  |     const zoom = Number(info.project.metadata.zoom);
  23  |     const preferences = {
  24  |       partition: { default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) } },
  25  |     };
  26  |     await writeFile(join(profile, "Default", "Preferences"), JSON.stringify(preferences), {
  27  |       flag: "wx",
  28  |     });
  29  |     const context = await playwright.chromium.launchPersistentContext(profile, {
  30  |       channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge",
  31  |       headless: true,
  32  |       viewport: info.project.name === "full390" ? { width: 390, height: 844 } : null,
  33  |       // Fixed physical window and OS scaling in both desktop control and 200%.
  34  |       args: ["--window-size=1304,992", "--force-device-scale-factor=1"],
  35  |       serviceWorkers: "block",
  36  |     });
> 37  |     await context.tracing.start({ screenshots: true, snapshots: true });
      |                           ^ Error: tracing.start: Tracing has been already started
  38  |     try {
  39  |       await use(context.pages()[0]);
  40  |     } finally {
  41  |       await context.tracing.stop({ path: info.outputPath("journey-trace.zip") });
  42  |       await context.close();
  43  |     }
  44  |   },
  45  | });
  46  | 
  47  | test("LOCAL R22 fixed viewport: keyboard demo boundary, case, reload, return and role denial", async ({
  48  |   demoPage: page,
  49  | }, info) => {
  50  |   test.setTimeout(120_000);
  51  |   const origin = String(info.project.use.baseURL);
  52  |   expect(new URL(origin).origin).toBe("http://127.0.0.1:5180");
  53  |   const width = Number(info.project.metadata.cssWidth);
  54  |   const height = Number(info.project.metadata.cssHeight);
  55  |   const zoom = Number(info.project.metadata.zoom);
  56  |   const denied: string[] = [];
  57  |   const pageErrors: string[] = [];
  58  |   const checkpoints: unknown[] = [];
  59  |   const requests: { method: string; path: string }[] = [];
  60  |   page.on("pageerror", (error) => pageErrors.push(error.message));
  61  |   await page.context().route("**/*", async (route) => {
  62  |     const request = route.request();
  63  |     const url = new URL(request.url());
  64  |     if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) {
  65  |       denied.push(`${request.method()} ${url.origin}${url.pathname}`);
  66  |       await route.abort("blockedbyclient");
  67  |       return;
  68  |     }
  69  |     requests.push({ method: request.method(), path: url.pathname });
  70  |     await route.continue();
  71  |   });
  72  |   await page.context().routeWebSocket("**/*", (socket) => {
  73  |     const target = new URL(socket.url());
  74  |     if (target.hostname === "127.0.0.1" && target.port === "5180") socket.connectToServer();
  75  |     else {
  76  |       denied.push(`WS ${target.origin}${target.pathname}`);
  77  |       socket.close();
  78  |     }
  79  |   });
  80  |   async function checkpoint(name: string) {
  81  |     await assertReflow(page, width);
  82  |     const metrics = await page.evaluate(() => ({
  83  |       innerWidth,
  84  |       innerHeight,
  85  |       outerWidth,
  86  |       outerHeight,
  87  |       devicePixelRatio,
  88  |       visualScale: visualViewport!.scale,
  89  |       visualWidth: visualViewport!.width,
  90  |       rootZoom: getComputedStyle(document.documentElement).zoom,
  91  |       bodyZoom: getComputedStyle(document.body).zoom,
  92  |       rootTransform: getComputedStyle(document.documentElement).transform,
  93  |       bodyTransform: getComputedStyle(document.body).transform,
  94  |     }));
  95  |     checkpoints.push({ name, path: new URL(page.url()).pathname, metrics });
  96  |     expect(metrics.innerWidth).toBe(width);
  97  |     expect(metrics.innerHeight).toBe(height);
  98  |     expect(metrics.devicePixelRatio).toBe(zoom);
  99  |     expect(metrics.visualScale).toBe(1);
  100 |     expect(metrics.visualWidth).toBe(width);
  101 |     expect(metrics.rootZoom).toBe("1");
  102 |     expect(metrics.bodyZoom).toBe("1");
  103 |     expect(metrics.rootTransform).toBe("none");
  104 |     expect(metrics.bodyTransform).toBe("none");
  105 |     if (info.project.name !== "full390") {
  106 |       expect(metrics.outerWidth).toBe(1304);
  107 |       expect(metrics.outerHeight).toBe(992);
  108 |       expect(page.viewportSize(), "desktop uses native window; no viewport override").toBeNull();
  109 |     } else expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  110 |     await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  111 |   }
  112 |   try {
  113 |     for (const persona of PERSONAS) {
  114 |       await page.goto(`${origin}/login?redirect=%2F`);
  115 |       await activate(page, page.getByRole("button", { name: new RegExp(persona.name) }));
  116 |       await expect(
  117 |         page.getByRole("heading", { level: 1, name: "總覽", exact: true }),
  118 |       ).toBeVisible();
  119 |       await checkpoint(`${persona.role}-overview`);
  120 |       const nav = await openNavigation(page);
  121 |       const account = page.getByRole("button", { name: "登出", exact: true }).locator("..");
  122 |       await expect(account.getByText(persona.name, { exact: true })).toBeVisible();
  123 |       await expect(account.getByText(persona.label, { exact: true })).toBeVisible();
  124 |       for (const label of ["用戶管理", "設定", "月表匯入"]) {
  125 |         await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(
  126 |           persona.role === "Admin" ? 1 : 0,
  127 |         );
  128 |       }
  129 |       await activate(page, nav.getByRole("link", { name: "客戶", exact: true }));
  130 |       await expect(page).toHaveURL((url) => url.pathname === "/clients");
  131 |       const main = page.getByRole("main");
  132 |       await expect(main.getByRole("region", { name: "示範模式未提供" })).toContainText(
  133 |         "客戶名冊讀取實時公司紀錄，並無示範資料。請登入正式環境使用。",
  134 |       );
  135 |       await expect(main.getByRole("table")).toHaveCount(0);
  136 |       await expect(main.locator('a[href^="/clients/"]')).toHaveCount(0);
  137 |       await checkpoint(`${persona.role}-client-unavailable`);
```