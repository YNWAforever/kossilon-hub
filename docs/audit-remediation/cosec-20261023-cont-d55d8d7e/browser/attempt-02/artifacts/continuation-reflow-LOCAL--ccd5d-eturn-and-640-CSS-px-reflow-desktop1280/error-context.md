# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: continuation-reflow.spec.ts >> LOCAL R22: keyboard demo boundaries, seeded annual-return reload/return and 640 CSS px reflow
- Location: e2e\continuation-reflow.spec.ts:117:1

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/clients$/
Received string:  "http://127.0.0.1:5180/clients?q=&status=all&team=all&includeFixtures=false"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    14 × locator resolved to <html lang="zh-Hant-HK" data-tsd-source="/src/routes/__root.tsx:196:5">…</html>
       - unexpected value "http://127.0.0.1:5180/clients?q=&status=all&team=all&includeFixtures=false"

```

```yaml
- complementary:
  - text: K Kossilon CoSec OS
  - navigation "主要導覽":
    - text: 今日工作
    - list:
      - listitem:
        - link "今日工作":
          - /url: /today
      - listitem:
        - link "總覽":
          - /url: /
      - listitem:
        - link "工作隊列":
          - /url: /work-queue
    - text: 案件與客戶
    - list:
      - listitem:
        - link "周年申報":
          - /url: /annual-returns
      - listitem:
        - link "客戶":
          - /url: /clients
      - listitem:
        - link "公司註冊":
          - /url: /incorporation
      - listitem:
        - link "公司變更":
          - /url: /corporate-changes
      - listitem:
        - link "月表匯入":
          - /url: /imports
    - text: 文件與付款
    - list:
      - listitem:
        - link "文件":
          - /url: /documents
      - listitem:
        - link "付款":
          - /url: /payments
      - listitem:
        - link "客戶入口":
          - /url: /portal
    - text: 通訊
    - list:
      - listitem:
        - link "WhatsApp 收件箱":
          - /url: /whatsapp
      - listitem:
        - link "WhatsApp 追件":
          - /url: /whatsapp/automation
    - text: 管理
    - list:
      - listitem:
        - link "用戶管理":
          - /url: /admin
      - listitem:
        - link "系統運作":
          - /url: /operations
      - listitem:
        - link "設定":
          - /url: /settings
  - text: AC Amy Chan 管理員
  - button "登出"
- main:
  - paragraph: 案件與客戶
  - heading "客戶" [level=1]
  - region "示範模式未提供":
    - paragraph: 示範模式未提供此資料
    - paragraph: 客戶名冊讀取實時公司紀錄，並無示範資料。請登入正式環境使用。
    - link "瀏覽周年申報案件":
      - /url: /annual-returns
- region "Notifications alt+T"
```

# Test source

```ts
  68  |   expect(geometry.document, "document must not scroll horizontally").toBeLessThanOrEqual(width + 1);
  69  |   expect(geometry.body, "body must not scroll horizontally").toBeLessThanOrEqual(width + 1);
  70  |   const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
  71  |   expect(heading).not.toBeNull();
  72  |   expect(heading!.x).toBeGreaterThanOrEqual(-1);
  73  |   expect(heading!.x + heading!.width).toBeLessThanOrEqual(width + 1);
  74  | }
  75  | 
  76  | async function assertReadonlyDelta(page: Page) {
  77  |   await expect(page).toHaveURL(new RegExp(`${CASE_PATH}$`));
  78  |   const main = page.getByRole("main");
  79  |   await expect(main.getByRole("heading", { level: 1, name: COMPANY, exact: true })).toBeVisible();
  80  |   await expect(main).toContainText("Joanna Poon · +852 9333 2211");
  81  |   await expect(main).toContainText("等待文件");
  82  |   await expect(main.getByRole("combobox", { name: "分配負責同事" })).toHaveValue("Iris Wong");
  83  |   for (const [label, value] of [
  84  |     ["付款", "pending"],
  85  |     ["簽署", "requested"],
  86  |     ["覆核", "not-started"],
  87  |   ]) {
  88  |     const control = main.getByLabel(label, { exact: true });
  89  |     await expect(control).toBeDisabled();
  90  |     await expect(control).toHaveValue(value);
  91  |   }
  92  |   const blockers = main.locator("section").filter({
  93  |     has: page.getByRole("heading", { name: "阻礙事項", exact: true }),
  94  |   });
  95  |   await expect(blockers).toContainText("Signed NAR1");
  96  |   await expect(blockers).toContainText("Updated significant controller register");
  97  |   await expect(blockers.getByRole("button", { name: "標記為已收到", exact: true })).toHaveCount(2);
  98  |   expect(await main.locator("button, select").count()).toBeGreaterThan(10);
  99  |   await expect(main.locator("button:enabled, select:enabled")).toHaveCount(0);
  100 |   await expect(main.getByRole("button", { name: "遞交交件套件", exact: true })).toBeDisabled();
  101 |   await expect(main.getByRole("button", { name: "接納回條", exact: true })).toBeDisabled();
  102 |   await expect(main.getByRole("button", { name: "加入備註", exact: true })).toBeDisabled();
  103 |   const note = main.getByRole("textbox", { name: "新增備註", exact: true });
  104 |   await expect(note).toHaveAttribute("readonly", "");
  105 |   await expect(note).toHaveValue("");
  106 |   await expect(main.getByText("暫時沒有備註。", { exact: true })).toBeVisible();
  107 |   await expect(main.getByText("Case seeded", { exact: true })).toBeVisible();
  108 |   await expect(main.getByRole("status")).toContainText("唯讀示範。案件狀態只可在正式環境");
  109 |   return main.locator("select, textarea").evaluateAll((elements) =>
  110 |     elements.map((element) => {
  111 |       const control = element as HTMLSelectElement | HTMLTextAreaElement;
  112 |       return { value: control.value, disabled: control.disabled };
  113 |     }),
  114 |   );
  115 | }
  116 | 
  117 | test("LOCAL R22: keyboard demo boundaries, seeded annual-return reload/return and 640 CSS px reflow", async ({
  118 |   page,
  119 | }, info) => {
  120 |   test.setTimeout(90_000);
  121 |   const initialViewport = page.viewportSize();
  122 |   expect(initialViewport).not.toBeNull();
  123 |   const base = new URL(String(info.project.use.baseURL));
  124 |   expect(base.protocol).toBe("http:");
  125 |   expect(["127.0.0.1", "localhost"]).toContain(base.hostname);
  126 |   expect(base.port).toBe("5180");
  127 |   const blockedRequests: string[] = [];
  128 |   const pageErrors: string[] = [];
  129 |   page.on("pageerror", (error) => pageErrors.push(error.message));
  130 |   // Abort unexpected browser requests, never fulfil/mock a production response.
  131 |   // This cannot establish server-side DB isolation; the parent owns that gate.
  132 |   await page.route("**/*", async (route) => {
  133 |     const request = route.request();
  134 |     const url = new URL(request.url());
  135 |     if (url.origin !== base.origin || !["GET", "HEAD"].includes(request.method())) {
  136 |       blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  137 |       await route.abort("blockedbyclient");
  138 |       return;
  139 |     }
  140 |     await route.continue();
  141 |   });
  142 |   info.annotations.push({
  143 |     type: "scope",
  144 |     description:
  145 |       "Local demo only; client record journey unavailable; 640 CSS px is reflow, not actual 200% zoom or native Auth.",
  146 |   });
  147 | 
  148 |   for (const persona of PERSONAS) {
  149 |     await test.step(`${persona.role}: keyboard login and honest client demo boundary`, async () => {
  150 |       await page.setViewportSize(initialViewport!);
  151 |       // Explicit existing redirect avoids inheriting the prior persona's
  152 |       // remembered deep link when this single test signs out and changes role.
  153 |       await page.goto("/login?redirect=%2F");
  154 |       await activate(page, page.getByRole("button", { name: new RegExp(persona.name) }));
  155 |       await expect(
  156 |         page.getByRole("heading", { level: 1, name: "總覽", exact: true }),
  157 |       ).toBeVisible();
  158 |       const nav = await openNavigation(page);
  159 |       const account = page.getByRole("button", { name: "登出", exact: true }).locator("..");
  160 |       await expect(account.getByText(persona.name, { exact: true })).toBeVisible();
  161 |       await expect(account.getByText(persona.label, { exact: true })).toBeVisible();
  162 |       for (const name of ["用戶管理", "設定", "月表匯入"]) {
  163 |         await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(
  164 |           persona.role === "Admin" ? 1 : 0,
  165 |         );
  166 |       }
  167 |       await activate(page, nav.getByRole("link", { name: "客戶", exact: true }));
> 168 |       await expect(page).toHaveURL(/\/clients$/);
      |                          ^ Error: expect(page).toHaveURL(expected) failed
  169 |       await expect(
  170 |         page.getByRole("heading", { level: 1, name: "客戶", exact: true }),
  171 |       ).toBeVisible();
  172 |       const main = page.getByRole("main");
  173 |       await expect(main.getByRole("region", { name: "示範模式未提供" })).toContainText(
  174 |         "客戶名冊讀取實時公司紀錄，並無示範資料。請登入正式環境使用。",
  175 |       );
  176 |       await expect(main.getByRole("table")).toHaveCount(0);
  177 |       await expect(main.locator('a[href^="/clients/"]')).toHaveCount(0);
  178 |       await assertReflow(page, initialViewport!.width);
  179 |       await page.setViewportSize(REFLOW);
  180 |       await assertReflow(page, REFLOW.width);
  181 | 
  182 |       const trigger = page.getByRole("button", { name: "開啟導覽選單", exact: true });
  183 |       const drawerNav = await openNavigation(page);
  184 |       const dialog = page.getByRole("dialog", { name: "導覽", exact: true });
  185 |       // More than one complete cycle: links + sign-out + close, including wrap.
  186 |       const tabCount = (await drawerNav.getByRole("link").count()) + 4;
  187 |       for (let index = 0; index < tabCount; index++) {
  188 |         await page.keyboard.press("Tab");
  189 |         expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
  190 |           true,
  191 |         );
  192 |       }
  193 |       await page.keyboard.press("Escape");
  194 |       await expect(dialog).not.toBeVisible();
  195 |       await assertKeyboardFocus(trigger);
  196 |       await page.screenshot({
  197 |         path: info.outputPath(`${persona.role}-clients-640.png`),
  198 |         fullPage: true,
  199 |       });
  200 |     });
  201 | 
  202 |     await test.step(`${persona.role}: real fixture board -> detail -> read-only reload -> return`, async () => {
  203 |       // This is DemoUnavailable's existing fallback, NOT a client-record link.
  204 |       await activate(page, page.getByRole("link", { name: "瀏覽周年申報案件", exact: true }));
  205 |       await expect(page).toHaveURL(/\/annual-returns$/);
  206 |       await expect(
  207 |         page.getByRole("heading", { level: 1, name: "周年申報", exact: true }),
  208 |       ).toBeVisible();
  209 |       const search = page.getByRole("textbox", { name: "搜尋公司或聯絡人" });
  210 |       await tabTo(page, search);
  211 |       await page.keyboard.type("Delta Bloom");
  212 |       const openCase = page.getByRole("link", { name: `開啟 ${COMPANY}`, exact: true });
  213 |       await expect(openCase).toHaveAttribute("href", CASE_PATH);
  214 |       const row = openCase.locator("../..");
  215 |       await expect(row).toContainText(COMPANY);
  216 |       await expect(row).toContainText("Joanna Poon");
  217 |       await expect(row).toContainText("Iris Wong");
  218 |       await expect(row).toContainText("付款：待付款");
  219 |       await expect(page.getByRole("main").locator('a[href^="/annual-returns/"]')).toHaveCount(1);
  220 |       await assertReflow(page, REFLOW.width);
  221 |       await activate(page, openCase);
  222 |       const beforeReload = await assertReadonlyDelta(page);
  223 |       await assertReflow(page, REFLOW.width);
  224 |       const note = page.getByRole("textbox", { name: "新增備註", exact: true });
  225 |       await tabTo(page, note);
  226 |       await page.keyboard.type("R22 read-only probe");
  227 |       await expect(note).toHaveValue("");
  228 |       await page.screenshot({
  229 |         path: info.outputPath(`${persona.role}-case-640.png`),
  230 |         fullPage: true,
  231 |       });
  232 |       await page.reload();
  233 |       expect(await assertReadonlyDelta(page)).toEqual(beforeReload);
  234 |       await assertReflow(page, REFLOW.width);
  235 |       await page.screenshot({
  236 |         path: info.outputPath(`${persona.role}-reload-640.png`),
  237 |         fullPage: true,
  238 |       });
  239 |       const back = page.getByRole("main").getByRole("link", { name: "返回", exact: true });
  240 |       await expect(back).toHaveAttribute("href", "/annual-returns");
  241 |       await activate(page, back);
  242 |       await expect(page).toHaveURL(/\/annual-returns$/);
  243 |       await expect(
  244 |         page.getByRole("heading", { level: 1, name: "周年申報", exact: true }),
  245 |       ).toBeVisible();
  246 |       await expect(page.getByRole("textbox", { name: "搜尋公司或聯絡人" })).toHaveValue("");
  247 |       await expect(openCase).toBeVisible();
  248 |       await expect(row).toContainText("Joanna Poon");
  249 |       await expect(row).toContainText("付款：待付款");
  250 |       await assertReflow(page, REFLOW.width);
  251 |     });
  252 | 
  253 |     await test.step(`${persona.role}: Admin read-only surface or Staff direct-route denial`, async () => {
  254 |       if (persona.role === "Admin") {
  255 |         const nav = await openNavigation(page);
  256 |         await activate(page, nav.getByRole("link", { name: "用戶管理", exact: true }));
  257 |         await expect(page).toHaveURL(/\/admin$/);
  258 |         await expect(
  259 |           page.getByRole("heading", { level: 1, name: "用戶管理", exact: true }),
  260 |         ).toBeVisible();
  261 |         const amy = page.getByRole("row").filter({ hasText: "Amy Chan" });
  262 |         await expect(amy.getByRole("combobox", { name: "Amy Chan 的角色" })).toHaveValue("Admin");
  263 |         await expect(amy.getByRole("combobox", { name: "Amy Chan 的角色" })).toBeDisabled();
  264 |         await expect(
  265 |           amy.getByRole("button", { name: "停用 Amy Chan", exact: true }),
  266 |         ).toBeDisabled();
  267 |       } else {
  268 |         await page.goto("/admin");
```