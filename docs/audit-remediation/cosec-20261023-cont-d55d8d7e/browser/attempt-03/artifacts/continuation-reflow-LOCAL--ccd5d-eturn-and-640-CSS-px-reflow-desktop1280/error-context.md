# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: continuation-reflow.spec.ts >> LOCAL R22: keyboard demo boundaries, seeded annual-return reload/return and 640 CSS px reflow
- Location: e2e\continuation-reflow.spec.ts:122:1

# Error details

```
Error: expect(locator).toBeDisabled() failed

Locator: getByRole('main').getByLabel('付款', { exact: true })
Expected: disabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeDisabled" getByRole('main').getByLabel('付款', { exact: true }) with timeout 5000ms
  - waiting for getByRole('main').getByLabel('付款', { exact: true })

```

```yaml
- banner:
  - button "開啟導覽選單"
  - text: K Kossilon CoSec OS
- main:
  - paragraph: 案件與客戶
  - heading "Delta Bloom Ventures Limited" [level=1]
  - paragraph: Joanna Poon · +852 9333 2211 · 申報基準日 2026年6月4日
  - link "返回":
    - /url: /annual-returns
  - link "分配及 SLA":
    - /url: /work-queue?view=team&owner=all&workType=all&sla=all&priority=all&status=all
  - status: 唯讀示範。案件狀態只可在正式環境經周年申報伺服器操作更改。
  - text: 已逾期 等待文件
  - paragraph: 到期日
  - paragraph: 2026年7月15日 · 已逾期 100 日
  - paragraph: 完成度
  - paragraph: 0%
  - paragraph: 下一步
  - paragraph: 索取 Signed NAR1
  - paragraph: 阻礙事項
  - paragraph: 5 項未解決
  - text: 負責同事
  - combobox "分配負責同事" [disabled]:
    - option "Iris Wong" [selected]
    - option "Calvin Ho"
    - option "Mandy Lee"
    - option "Operations"
  - heading "阻礙事項" [level=2]
  - paragraph: 拖低完成度的文件、付款、簽署及覆核阻礙事項。
  - text: 5 項未解決
  - paragraph: Signed NAR1
  - paragraph: 缺少
  - button "標記為已收到" [disabled]
  - paragraph: Updated significant controller register
  - paragraph: 缺少
  - button "標記為已收到" [disabled]
  - text: 付款
  - combobox "付款" [disabled]:
    - option "待付款" [selected]
    - option "已付款"
    - option "逾期未付"
  - text: 簽署
  - combobox "簽署" [disabled]:
    - option "缺少"
    - option "已要求" [selected]
    - option "已收到"
  - text: 覆核
  - combobox "覆核" [disabled]:
    - option "未開始" [selected]
    - option "覆核中"
    - option "已批准"
  - heading "交件套件" [level=2]
  - paragraph: 示範 NAR1 交件套件於遞交前的現況。
  - text: 未開始
  - paragraph: 交件套件完成度 0%
  - button "NAR1 draft prepared 未完成" [disabled]
  - button "Company particulars checked 未完成" [disabled]
  - button "Significant controller register confirmed 未完成" [disabled]
  - button "Signed NAR1 attached 未完成" [disabled]
  - button "Payment proof checked 未完成" [disabled]
  - button "Internal filing review approved 未完成" [disabled]
  - button "遞交交件套件" [disabled]
  - button "接納回條" [disabled]
  - heading "跟進" [level=2]
  - paragraph: 按目前阻礙事項產生的示範 WhatsApp 提醒。
  - text: 11 項待跟進
  - paragraph: 索取缺少文件
  - paragraph: Joanna Poon / +852 9333 2211 / 今日發送
  - text: 草稿
  - paragraph: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「Signed NAR1」待處理，完成後我們即可遞交。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 索取缺少文件
  - paragraph: Joanna Poon / +852 9333 2211 / 今日發送
  - text: 草稿
  - paragraph: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「Updated significant controller register」待處理，完成後我們即可遞交。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 付款提醒
  - paragraph: Joanna Poon / +852 9333 2211 / 今日發送
  - text: 草稿
  - paragraph: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「待付款」待處理，完成後我們即可遞交。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 簽署提醒
  - paragraph: Joanna Poon / +852 9333 2211 / 下午 5 時前發送
  - text: 草稿
  - paragraph: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「已要求簽署」待處理，完成後我們即可遞交。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 覆核升級處理
  - paragraph: Iris Wong / +852 9333 2211 / 內部升級處理
  - text: 草稿
  - paragraph: Iris Wong，請在遞交前處理 Delta Bloom Ventures Limited 的「內部覆核未開始」。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 交件套件提醒
  - paragraph: Iris Wong / +852 9333 2211 / 遞交前覆核
  - text: 草稿
  - paragraph: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「NAR1 draft prepared」仍未完成。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 交件套件提醒
  - paragraph: Iris Wong / +852 9333 2211 / 遞交前覆核
  - text: 草稿
  - paragraph: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Company particulars checked」仍未完成。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 交件套件提醒
  - paragraph: Iris Wong / +852 9333 2211 / 遞交前覆核
  - text: 草稿
  - paragraph: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Significant controller register confirmed」仍未完成。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 交件套件提醒
  - paragraph: Iris Wong / +852 9333 2211 / 遞交前覆核
  - text: 草稿
  - paragraph: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Signed NAR1 attached」仍未完成。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 交件套件提醒
  - paragraph: Iris Wong / +852 9333 2211 / 遞交前覆核
  - text: 草稿
  - paragraph: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Payment proof checked」仍未完成。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - paragraph: 交件套件提醒
  - paragraph: Iris Wong / +852 9333 2211 / 遞交前覆核
  - text: 草稿
  - paragraph: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Internal filing review approved」仍未完成。
  - paragraph: 按目前阻礙事項草擬
  - button "立即發送" [disabled]
  - heading "清單" [level=2]
  - paragraph: 同事工作項目，隨工作推進或重開而更新。
  - text: 1/5
  - button "Confirm company particulars 已完成" [disabled]
  - button "Collect signed NAR1 未完成" [disabled]
  - button "Verify significant controller register 未完成" [disabled]
  - button "Confirm filing fee payment 未完成" [disabled]
  - button "Submit to Companies Registry 未完成" [disabled]
  - heading "備註" [level=2]
  - paragraph: 同事就此案件記錄的背景資料。
  - text: 0 則備註
  - textbox "新增備註"
  - button "加入備註" [disabled]
  - paragraph: 暫時沒有備註。
  - heading "客戶入口活動" [level=2]
  - paragraph: 此案件的客戶操作及存檔記錄。
  - text: 2 項待處理
  - paragraph: 待處理
  - paragraph: "2"
  - paragraph: 存檔
  - paragraph: "2"
  - paragraph: 最近活動
  - paragraph: 沒有
  - link "開啟存檔":
    - /url: /documents?caseId=ar-delta
  - link "開啟客戶入口":
    - /url: /portal?caseId=ar-delta
  - heading "時間線" [level=2]
  - paragraph: 最新的案件活動排在最前。
  - text: 1 項事件
  - paragraph: Case seeded
  - paragraph: 2026年7月1日 17:00
  - paragraph: Due-soon case blocked by documents, payment, and review.
- region "Notifications alt+T"
```

# Test source

```ts
  1   | import { test, expect, type Locator, type Page } from "@playwright/test";
  2   | 
  3   | // Existing fixture-backed demo only. 640 CSS px models the reflow space of a
  4   | // 1280px layout at 200%; it is NOT browser zoom, native Auth or backend UAT.
  5   | const REFLOW = { width: 640, height: 450 };
  6   | const COMPANY = "Delta Bloom Ventures Limited";
  7   | const CASE_PATH = "/annual-returns/ar-delta";
  8   | const PERSONAS = [
  9   |   { name: "Amy Chan", role: "Admin", label: "管理員" },
  10  |   { name: "Mei Lam", role: "Staff", label: "同事" },
  11  | ] as const;
  12  | 
  13  | async function assertKeyboardFocus(target: Locator) {
  14  |   await expect(target).toBeFocused();
  15  |   await expect(target).toBeInViewport();
  16  |   // Radix's drawer can be visible/focused during its 500ms entrance animation.
  17  |   // Wait for the same geometry/focus contract, rather than sampling mid-slide.
  18  |   await expect
  19  |     .poll(() =>
  20  |       target.evaluate((element) => {
  21  |         const style = getComputedStyle(element);
  22  |         const rect = element.getBoundingClientRect();
  23  |         return {
  24  |           visible: element.matches(":focus-visible"),
  25  |           cue:
  26  |             (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
  27  |             style.boxShadow !== "none",
  28  |           contained: rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1,
  29  |         };
  30  |       }),
  31  |     )
  32  |     .toEqual({ visible: true, cue: true, contained: true });
  33  | }
  34  | 
  35  | // Find the real sequential tab stop, rather than using locator.focus() to make
  36  | // an otherwise unreachable control look keyboard accessible.
  37  | async function tabTo(page: Page, target: Locator) {
  38  |   await expect(target).toBeVisible();
  39  |   for (let count = 0; count < 80; count++) {
  40  |     if (await target.evaluate((element) => element === document.activeElement)) {
  41  |       await assertKeyboardFocus(target);
  42  |       return;
  43  |     }
  44  |     await page.keyboard.press("Tab");
  45  |   }
  46  |   throw new Error(`Target was not reached within 80 Tab presses: ${target.toString()}`);
  47  | }
  48  | 
  49  | async function activate(page: Page, target: Locator) {
  50  |   await tabTo(page, target);
  51  |   await page.keyboard.press("Enter");
  52  | }
  53  | 
  54  | async function openNavigation(page: Page) {
  55  |   const trigger = page.getByRole("button", { name: "開啟導覽選單", exact: true });
  56  |   if (await trigger.isVisible()) {
  57  |     await activate(page, trigger);
  58  |     await expect(page.getByRole("dialog", { name: "導覽", exact: true })).toBeVisible();
  59  |   }
  60  |   const nav = page.getByRole("navigation", { name: "主要導覽", exact: true });
  61  |   await expect(nav).toBeVisible();
  62  |   return nav;
  63  | }
  64  | 
  65  | async function assertReflow(page: Page, width: number) {
  66  |   await expect(page.getByRole("main")).toBeVisible();
  67  |   const geometry = await page.evaluate(() => ({
  68  |     viewport: window.innerWidth,
  69  |     document: document.documentElement.scrollWidth,
  70  |     body: document.body.scrollWidth,
  71  |   }));
  72  |   expect(geometry.viewport).toBe(width);
  73  |   expect(geometry.document, "document must not scroll horizontally").toBeLessThanOrEqual(width + 1);
  74  |   expect(geometry.body, "body must not scroll horizontally").toBeLessThanOrEqual(width + 1);
  75  |   const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
  76  |   expect(heading).not.toBeNull();
  77  |   expect(heading!.x).toBeGreaterThanOrEqual(-1);
  78  |   expect(heading!.x + heading!.width).toBeLessThanOrEqual(width + 1);
  79  | }
  80  | 
  81  | async function assertReadonlyDelta(page: Page) {
  82  |   await expect(page).toHaveURL(new RegExp(`${CASE_PATH}$`));
  83  |   const main = page.getByRole("main");
  84  |   await expect(main.getByRole("heading", { level: 1, name: COMPANY, exact: true })).toBeVisible();
  85  |   await expect(main).toContainText("Joanna Poon · +852 9333 2211");
  86  |   await expect(main).toContainText("等待文件");
  87  |   await expect(main.getByRole("combobox", { name: "分配負責同事" })).toHaveValue("Iris Wong");
  88  |   for (const [label, value] of [
  89  |     ["付款", "pending"],
  90  |     ["簽署", "requested"],
  91  |     ["覆核", "not-started"],
  92  |   ]) {
  93  |     const control = main.getByLabel(label, { exact: true });
> 94  |     await expect(control).toBeDisabled();
      |                           ^ Error: expect(locator).toBeDisabled() failed
  95  |     await expect(control).toHaveValue(value);
  96  |   }
  97  |   const blockers = main.locator("section").filter({
  98  |     has: page.getByRole("heading", { name: "阻礙事項", exact: true }),
  99  |   });
  100 |   await expect(blockers).toContainText("Signed NAR1");
  101 |   await expect(blockers).toContainText("Updated significant controller register");
  102 |   await expect(blockers.getByRole("button", { name: "標記為已收到", exact: true })).toHaveCount(2);
  103 |   expect(await main.locator("button, select").count()).toBeGreaterThan(10);
  104 |   await expect(main.locator("button:enabled, select:enabled")).toHaveCount(0);
  105 |   await expect(main.getByRole("button", { name: "遞交交件套件", exact: true })).toBeDisabled();
  106 |   await expect(main.getByRole("button", { name: "接納回條", exact: true })).toBeDisabled();
  107 |   await expect(main.getByRole("button", { name: "加入備註", exact: true })).toBeDisabled();
  108 |   const note = main.getByRole("textbox", { name: "新增備註", exact: true });
  109 |   await expect(note).toHaveAttribute("readonly", "");
  110 |   await expect(note).toHaveValue("");
  111 |   await expect(main.getByText("暫時沒有備註。", { exact: true })).toBeVisible();
  112 |   await expect(main.getByText("Case seeded", { exact: true })).toBeVisible();
  113 |   await expect(main.getByRole("status")).toContainText("唯讀示範。案件狀態只可在正式環境");
  114 |   return main.locator("select, textarea").evaluateAll((elements) =>
  115 |     elements.map((element) => {
  116 |       const control = element as HTMLSelectElement | HTMLTextAreaElement;
  117 |       return { value: control.value, disabled: control.disabled };
  118 |     }),
  119 |   );
  120 | }
  121 | 
  122 | test("LOCAL R22: keyboard demo boundaries, seeded annual-return reload/return and 640 CSS px reflow", async ({
  123 |   page,
  124 | }, info) => {
  125 |   test.setTimeout(90_000);
  126 |   const initialViewport = page.viewportSize();
  127 |   expect(initialViewport).not.toBeNull();
  128 |   const base = new URL(String(info.project.use.baseURL));
  129 |   expect(base.protocol).toBe("http:");
  130 |   expect(["127.0.0.1", "localhost"]).toContain(base.hostname);
  131 |   expect(base.port).toBe("5180");
  132 |   const blockedRequests: string[] = [];
  133 |   const pageErrors: string[] = [];
  134 |   page.on("pageerror", (error) => pageErrors.push(error.message));
  135 |   // Abort unexpected browser requests, never fulfil/mock a production response.
  136 |   // This cannot establish server-side DB isolation; the parent owns that gate.
  137 |   await page.route("**/*", async (route) => {
  138 |     const request = route.request();
  139 |     const url = new URL(request.url());
  140 |     if (url.origin !== base.origin || !["GET", "HEAD"].includes(request.method())) {
  141 |       blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  142 |       await route.abort("blockedbyclient");
  143 |       return;
  144 |     }
  145 |     await route.continue();
  146 |   });
  147 |   info.annotations.push({
  148 |     type: "scope",
  149 |     description:
  150 |       "Local demo only; client record journey unavailable; 640 CSS px is reflow, not actual 200% zoom or native Auth.",
  151 |   });
  152 | 
  153 |   for (const persona of PERSONAS) {
  154 |     await test.step(`${persona.role}: keyboard login and honest client demo boundary`, async () => {
  155 |       await page.setViewportSize(initialViewport!);
  156 |       // Explicit existing redirect avoids inheriting the prior persona's
  157 |       // remembered deep link when this single test signs out and changes role.
  158 |       await page.goto("/login?redirect=%2F");
  159 |       await activate(page, page.getByRole("button", { name: new RegExp(persona.name) }));
  160 |       await expect(
  161 |         page.getByRole("heading", { level: 1, name: "總覽", exact: true }),
  162 |       ).toBeVisible();
  163 |       const nav = await openNavigation(page);
  164 |       const account = page.getByRole("button", { name: "登出", exact: true }).locator("..");
  165 |       await expect(account.getByText(persona.name, { exact: true })).toBeVisible();
  166 |       await expect(account.getByText(persona.label, { exact: true })).toBeVisible();
  167 |       for (const name of ["用戶管理", "設定", "月表匯入"]) {
  168 |         await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(
  169 |           persona.role === "Admin" ? 1 : 0,
  170 |         );
  171 |       }
  172 |       await activate(page, nav.getByRole("link", { name: "客戶", exact: true }));
  173 |       await expect(page).toHaveURL(
  174 |         (url) =>
  175 |           url.pathname === "/clients" &&
  176 |           url.searchParams.get("q") === "" &&
  177 |           url.searchParams.get("status") === "all" &&
  178 |           url.searchParams.get("team") === "all" &&
  179 |           url.searchParams.get("includeFixtures") === "false" &&
  180 |           !url.searchParams.has("cursor"),
  181 |       );
  182 |       await expect(
  183 |         page.getByRole("heading", { level: 1, name: "客戶", exact: true }),
  184 |       ).toBeVisible();
  185 |       const main = page.getByRole("main");
  186 |       await expect(main.getByRole("region", { name: "示範模式未提供" })).toContainText(
  187 |         "客戶名冊讀取實時公司紀錄，並無示範資料。請登入正式環境使用。",
  188 |       );
  189 |       await expect(main.getByRole("table")).toHaveCount(0);
  190 |       await expect(main.locator('a[href^="/clients/"]')).toHaveCount(0);
  191 |       await assertReflow(page, initialViewport!.width);
  192 |       await page.setViewportSize(REFLOW);
  193 |       await assertReflow(page, REFLOW.width);
  194 | 
```