# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: continuation-reflow.spec.ts >> LOCAL R22: keyboard demo boundaries, seeded annual-return reload/return and 640 CSS px reflow
- Location: e2e\continuation-reflow.spec.ts:117:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Object {
-   "contained": true,
+   "contained": false,
    "cue": true,
    "visible": true,
  }
```

# Page snapshot

```yaml
- generic:
  - generic [aria-hidden]:
    - generic:
      - banner:
        - button [expanded]
        - generic:
          - generic: K
          - generic:
            - generic: Kossilon
            - generic: CoSec OS
      - main:
        - generic:
          - generic:
            - paragraph: 今日工作
            - heading [level=1]: 總覽
            - paragraph: 早晨，Amy。你有 4 宗進行中的案件。
        - generic:
          - generic:
            - generic:
              - paragraph: 7 日內到期
            - generic:
              - paragraph: "0"
              - paragraph: 周年申報
          - generic:
            - generic:
              - paragraph: 30 日內到期
            - generic:
              - paragraph: "0"
              - paragraph: 周年申報
          - generic:
            - generic:
              - paragraph: 已逾期案件
            - generic:
              - paragraph: "4"
              - paragraph: 需即時處理
          - generic:
            - generic:
              - paragraph: 待核對文件（份）
            - generic:
              - paragraph: "5"
              - paragraph: 目前授權範圍；包括已收但未覆核
          - generic:
            - generic:
              - paragraph: 待付款
            - generic:
              - paragraph: "3"
              - paragraph: 客戶未付款
          - generic:
            - generic:
              - paragraph: 分配給我
            - generic:
              - paragraph: "4"
              - paragraph: 進行中案件
        - generic:
          - generic:
            - generic:
              - generic:
                - heading [level=2]: 優先處理
                - paragraph: 今日下班前有 4 項優先工作
                - paragraph: 按申報到期日、風險程度及欠缺的必要文件排序；案件資料不經任何 AI 模型處理。
            - generic:
              - generic: 4 項緊急
              - generic: 0 項高
              - generic: 0 項中
          - list:
            - listitem:
              - generic: 緊急
              - generic:
                - generic:
                  - paragraph: 升級處理 Crestview Logistics Limited 的周年申報
                  - generic: 周年申報
                - paragraph: 待收文件；已逾期 135 日；1 項證明文件未齊。
              - generic:
                - link:
                  - /url: /annual-returns/ar-crestview
                  - text: 開啟案件
            - listitem:
              - generic: 緊急
              - generic:
                - generic:
                  - paragraph: 升級處理 Delta Bloom Ventures Limited 的周年申報
                  - generic: 周年申報
                - paragraph: 待收文件；已逾期 100 日；2 項證明文件未齊。
              - generic:
                - link:
                  - /url: /annual-returns/ar-delta
                  - text: 開啟案件
            - listitem:
              - generic: 緊急
              - generic:
                - generic:
                  - paragraph: 升級處理 Aurora Trading Limited 的周年申報
                  - generic: 周年申報
                - paragraph: 待收文件；已逾期 72 日；2 項證明文件未齊。
              - generic:
                - link:
                  - /url: /annual-returns/ar-aurora
                  - text: 開啟案件
            - listitem:
              - generic: 緊急
              - generic:
                - generic:
                  - paragraph: 升級處理 Harbour Pixel Studio Limited 的周年申報
                  - generic: 周年申報
                - paragraph: 可遞交；已逾期 86 日；證明文件齊全。
              - generic:
                - link:
                  - /url: /annual-returns/ar-harbour
                  - text: 開啟案件
        - generic:
          - generic:
            - generic:
              - generic:
                - heading [level=2]: 即將到期的周年申報
                - paragraph: 按到期日排序
              - link:
                - /url: /annual-returns
                - text: 開啟案件板 →
            - generic:
              - table:
                - rowgroup:
                  - row:
                    - columnheader: 公司
                    - columnheader: 到期日
                    - columnheader: 狀態
                    - columnheader: 負責同事
                    - columnheader: 下一步
                - rowgroup:
                  - row:
                    - cell:
                      - link:
                        - /url: /annual-returns/ar-crestview
                        - text: Crestview Logistics Limited
                      - generic: 2026年6月10日
                    - cell:
                      - generic: 已逾期 135 日
                    - cell:
                      - generic: 待收文件
                    - cell: Calvin Ho
                    - cell: 1 項證明文件待核對
                  - row:
                    - cell:
                      - link:
                        - /url: /annual-returns/ar-delta
                        - text: Delta Bloom Ventures Limited
                      - generic: 2026年7月15日
                    - cell:
                      - generic: 已逾期 100 日
                    - cell:
                      - generic: 待收文件
                    - cell: Iris Wong
                    - cell: 2 項證明文件待核對
                  - row:
                    - cell:
                      - link:
                        - /url: /annual-returns/ar-aurora
                        - text: Aurora Trading Limited
                      - generic: 2026年8月12日
                    - cell:
                      - generic: 已逾期 72 日
                    - cell:
                      - generic: 待收文件
                    - cell: Mandy Lee
                    - cell: 2 項證明文件待核對
                  - row:
                    - cell:
                      - link:
                        - /url: /annual-returns/ar-harbour
                        - text: Harbour Pixel Studio Limited
                      - generic: 2026年7月29日
                    - cell:
                      - generic: 已逾期 86 日
                    - cell:
                      - generic: 可遞交
                    - cell: Iris Wong
                    - cell: 記錄遞交證明
        - generic:
          - generic:
            - generic:
              - generic:
                - heading [level=2]: 需即時處理
                - paragraph: 4 宗周年申報已逾期。請立即分配或升級處理，以免被公司註冊處罰款。
                - link:
                  - /url: /annual-returns
                  - text: 查看已逾期案件
  - region "Notifications alt+T"
  - dialog [ref=e2]:
    - button "Close" [ref=e3] [cursor=pointer]
    - heading "導覽" [level=2] [ref=e8]
    - generic [ref=e10]:
      - generic [ref=e11]: K
      - generic [ref=e13]:
        - generic [ref=e14]: Kossilon
        - generic [ref=e15]: CoSec OS
    - navigation "主要導覽" [ref=e16]:
      - generic [ref=e17]:
        - generic [ref=e18]:
          - generic [ref=e19]: 今日工作
          - list [ref=e20]:
            - listitem [ref=e21]:
              - link "今日工作" [ref=e22] [cursor=pointer]:
                - /url: /today
            - listitem [ref=e28]:
              - link "總覽" [ref=e29] [cursor=pointer]:
                - /url: /
            - listitem [ref=e36]:
              - link "工作隊列" [ref=e37] [cursor=pointer]:
                - /url: /work-queue
        - generic [ref=e42]:
          - generic [ref=e43]: 案件與客戶
          - list [ref=e44]:
            - listitem [ref=e45]:
              - link "周年申報" [ref=e46] [cursor=pointer]:
                - /url: /annual-returns
            - listitem [ref=e52]:
              - link "客戶" [active] [ref=e53] [cursor=pointer]:
                - /url: /clients
            - listitem [ref=e59]:
              - link "公司註冊" [ref=e60] [cursor=pointer]:
                - /url: /incorporation
            - listitem [ref=e67]:
              - link "公司變更" [ref=e68] [cursor=pointer]:
                - /url: /corporate-changes
            - listitem [ref=e75]:
              - link "月表匯入" [ref=e76] [cursor=pointer]:
                - /url: /imports
        - generic [ref=e81]:
          - generic [ref=e82]: 文件與付款
          - list [ref=e83]:
            - listitem [ref=e84]:
              - link "文件" [ref=e85] [cursor=pointer]:
                - /url: /documents
            - listitem [ref=e90]:
              - link "付款" [ref=e91] [cursor=pointer]:
                - /url: /payments
            - listitem [ref=e95]:
              - link "客戶入口" [ref=e96] [cursor=pointer]:
                - /url: /portal
        - generic [ref=e102]:
          - generic [ref=e103]: 通訊
          - list [ref=e104]:
            - listitem [ref=e105]:
              - link "WhatsApp 收件箱" [ref=e106] [cursor=pointer]:
                - /url: /whatsapp
            - listitem [ref=e110]:
              - link "WhatsApp 追件" [ref=e111] [cursor=pointer]:
                - /url: /whatsapp/automation
        - generic [ref=e115]:
          - generic [ref=e116]: 管理
          - list [ref=e117]:
            - listitem [ref=e118]:
              - link "用戶管理" [ref=e119] [cursor=pointer]:
                - /url: /admin
            - listitem [ref=e124]:
              - link "系統運作" [ref=e125] [cursor=pointer]:
                - /url: /operations
            - listitem [ref=e129]:
              - link "設定" [ref=e130] [cursor=pointer]:
                - /url: /settings
    - generic [ref=e135]:
      - generic [ref=e136]: AC
      - generic [ref=e137]:
        - generic [ref=e138]: Amy Chan
        - generic [ref=e139]: 管理員
      - button "登出" [ref=e140]
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
  16  |   const focus = await target.evaluate((element) => {
  17  |     const style = getComputedStyle(element);
  18  |     const rect = element.getBoundingClientRect();
  19  |     return {
  20  |       visible: element.matches(":focus-visible"),
  21  |       cue:
  22  |         (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
  23  |         style.boxShadow !== "none",
  24  |       contained: rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1,
  25  |     };
  26  |   });
> 27  |   expect(focus).toEqual({ visible: true, cue: true, contained: true });
      |                 ^ Error: expect(received).toEqual(expected) // deep equality
  28  | }
  29  | 
  30  | // Find the real sequential tab stop, rather than using locator.focus() to make
  31  | // an otherwise unreachable control look keyboard accessible.
  32  | async function tabTo(page: Page, target: Locator) {
  33  |   await expect(target).toBeVisible();
  34  |   for (let count = 0; count < 80; count++) {
  35  |     if (await target.evaluate((element) => element === document.activeElement)) {
  36  |       await assertKeyboardFocus(target);
  37  |       return;
  38  |     }
  39  |     await page.keyboard.press("Tab");
  40  |   }
  41  |   throw new Error(`Target was not reached within 80 Tab presses: ${target.toString()}`);
  42  | }
  43  | 
  44  | async function activate(page: Page, target: Locator) {
  45  |   await tabTo(page, target);
  46  |   await page.keyboard.press("Enter");
  47  | }
  48  | 
  49  | async function openNavigation(page: Page) {
  50  |   const trigger = page.getByRole("button", { name: "開啟導覽選單", exact: true });
  51  |   if (await trigger.isVisible()) {
  52  |     await activate(page, trigger);
  53  |     await expect(page.getByRole("dialog", { name: "導覽", exact: true })).toBeVisible();
  54  |   }
  55  |   const nav = page.getByRole("navigation", { name: "主要導覽", exact: true });
  56  |   await expect(nav).toBeVisible();
  57  |   return nav;
  58  | }
  59  | 
  60  | async function assertReflow(page: Page, width: number) {
  61  |   await expect(page.getByRole("main")).toBeVisible();
  62  |   const geometry = await page.evaluate(() => ({
  63  |     viewport: window.innerWidth,
  64  |     document: document.documentElement.scrollWidth,
  65  |     body: document.body.scrollWidth,
  66  |   }));
  67  |   expect(geometry.viewport).toBe(width);
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
```