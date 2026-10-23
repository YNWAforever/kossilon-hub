# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: r22-viewport-zoom.spec.ts >> LOCAL R22 fixed viewport: keyboard demo boundary, case, reload, return and role denial
- Location: e2e\r22-viewport-zoom.spec.ts:46:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Object {
    "clipping": Array [],
    "ownTextFits": true,
-   "unobscured": true,
+   "unobscured": false,
    "viewport": true,
  }
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - button "開啟導覽選單" [ref=e5]
      - generic [ref=e7]:
        - generic [ref=e8]: K
        - generic [ref=e10]:
          - generic [ref=e11]: Kossilon
          - generic [ref=e12]: CoSec OS
    - main [ref=e13]:
      - generic [ref=e14]:
        - generic [ref=e15]:
          - paragraph [ref=e16]: 案件與客戶
          - heading "Delta Bloom Ventures Limited" [level=1] [ref=e17]
          - paragraph [ref=e18]: Joanna Poon · +852 9333 2211 · 申報基準日 2026年6月4日
        - generic [ref=e19]:
          - link "返回" [ref=e20] [cursor=pointer]:
            - /url: /annual-returns
          - link "分配及 SLA" [ref=e21] [cursor=pointer]:
            - /url: /work-queue?view=team&owner=all&workType=all&sla=all&priority=all&status=all
      - status [ref=e22]: 唯讀示範。案件狀態只可在正式環境經周年申報伺服器操作更改。
      - generic [ref=e24]:
        - generic [ref=e25]:
          - generic [ref=e27]:
            - generic [ref=e28]: 已逾期
            - generic [ref=e30]: 等待文件
          - generic [ref=e31]:
            - generic [ref=e32]:
              - paragraph [ref=e34]: 到期日
              - paragraph [ref=e36]: 2026年7月15日 · 已逾期 100 日
            - generic [ref=e37]:
              - paragraph [ref=e39]: 完成度
              - paragraph [ref=e41]: 0%
            - generic [ref=e42]:
              - paragraph [ref=e44]: 下一步
              - paragraph [ref=e46]: 索取 Signed NAR1
            - generic [ref=e47]:
              - paragraph [ref=e49]: 阻礙事項
              - paragraph [ref=e51]: 5 項未解決
        - generic [ref=e53]:
          - text: 負責同事
          - combobox "分配負責同事" [disabled] [ref=e54]:
            - option "Iris Wong" [selected]
            - option "Calvin Ho"
            - option "Mandy Lee"
            - option "Operations"
      - generic [ref=e55]:
        - generic [ref=e56]:
          - generic [ref=e57]:
            - generic [ref=e58]:
              - generic [ref=e59]:
                - heading "阻礙事項" [level=2] [ref=e60]
                - paragraph [ref=e61]: 拖低完成度的文件、付款、簽署及覆核阻礙事項。
              - generic [ref=e62]: 5 項未解決
            - generic [ref=e63]:
              - generic [ref=e64]:
                - generic [ref=e65]:
                  - paragraph [ref=e66]: Signed NAR1
                  - paragraph [ref=e67]: 缺少
                - button "標記為已收到" [disabled]
              - generic [ref=e68]:
                - generic [ref=e69]:
                  - paragraph [ref=e70]: Updated significant controller register
                  - paragraph [ref=e71]: 缺少
                - button "標記為已收到" [disabled]
            - generic [ref=e72]:
              - generic [ref=e73]:
                - text: 付款
                - combobox "付款" [disabled] [ref=e74]:
                  - option "待付款" [selected]
                  - option "已付款"
                  - option "逾期未付"
              - generic [ref=e75]:
                - text: 簽署
                - combobox "簽署" [disabled] [ref=e76]:
                  - option "缺少"
                  - option "已要求" [selected]
                  - option "已收到"
              - generic [ref=e77]:
                - text: 覆核
                - combobox "覆核" [disabled] [ref=e78]:
                  - option "未開始" [selected]
                  - option "覆核中"
                  - option "已批准"
          - generic [ref=e79]:
            - generic [ref=e80]:
              - generic [ref=e81]:
                - heading "交件套件" [level=2] [ref=e82]
                - paragraph [ref=e83]: 示範 NAR1 交件套件於遞交前的現況。
              - generic [ref=e84]:
                - generic [ref=e85]: 未開始
                - paragraph [ref=e86]: 交件套件完成度 0%
            - generic [ref=e87]:
              - button "NAR1 draft prepared 未完成" [disabled] [ref=e88]:
                - generic [ref=e89]: NAR1 draft prepared
                - generic [ref=e90]: 未完成
              - button "Company particulars checked 未完成" [disabled] [ref=e91]:
                - generic [ref=e92]: Company particulars checked
                - generic [ref=e93]: 未完成
              - button "Significant controller register confirmed 未完成" [disabled] [ref=e94]:
                - generic [ref=e95]: Significant controller register confirmed
                - generic [ref=e96]: 未完成
              - button "Signed NAR1 attached 未完成" [disabled] [ref=e97]:
                - generic [ref=e98]: Signed NAR1 attached
                - generic [ref=e99]: 未完成
              - button "Payment proof checked 未完成" [disabled] [ref=e100]:
                - generic [ref=e101]: Payment proof checked
                - generic [ref=e102]: 未完成
              - button "Internal filing review approved 未完成" [disabled] [ref=e103]:
                - generic [ref=e104]: Internal filing review approved
                - generic [ref=e105]: 未完成
            - generic [ref=e106]:
              - button "遞交交件套件" [disabled]
              - button "接納回條" [disabled]
          - generic [ref=e107]:
            - generic [ref=e108]:
              - generic [ref=e109]:
                - heading "跟進" [level=2] [ref=e110]
                - paragraph [ref=e111]: 按目前阻礙事項產生的示範 WhatsApp 提醒。
              - generic [ref=e112]: 11 項待跟進
            - generic [ref=e113]:
              - generic [ref=e114]:
                - generic [ref=e115]:
                  - generic [ref=e116]:
                    - paragraph [ref=e117]: 索取缺少文件
                    - paragraph [ref=e118]: Joanna Poon / +852 9333 2211 / 今日發送
                  - generic [ref=e119]: 草稿
                - paragraph [ref=e120]: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「Signed NAR1」待處理，完成後我們即可遞交。
                - generic [ref=e121]:
                  - paragraph [ref=e122]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e123]:
                - generic [ref=e124]:
                  - generic [ref=e125]:
                    - paragraph [ref=e126]: 索取缺少文件
                    - paragraph [ref=e127]: Joanna Poon / +852 9333 2211 / 今日發送
                  - generic [ref=e128]: 草稿
                - paragraph [ref=e129]: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「Updated significant controller register」待處理，完成後我們即可遞交。
                - generic [ref=e130]:
                  - paragraph [ref=e131]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e132]:
                - generic [ref=e133]:
                  - generic [ref=e134]:
                    - paragraph [ref=e135]: 付款提醒
                    - paragraph [ref=e136]: Joanna Poon / +852 9333 2211 / 今日發送
                  - generic [ref=e137]: 草稿
                - paragraph [ref=e138]: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「待付款」待處理，完成後我們即可遞交。
                - generic [ref=e139]:
                  - paragraph [ref=e140]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e141]:
                - generic [ref=e142]:
                  - generic [ref=e143]:
                    - paragraph [ref=e144]: 簽署提醒
                    - paragraph [ref=e145]: Joanna Poon / +852 9333 2211 / 下午 5 時前發送
                  - generic [ref=e146]: 草稿
                - paragraph [ref=e147]: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「已要求簽署」待處理，完成後我們即可遞交。
                - generic [ref=e148]:
                  - paragraph [ref=e149]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e150]:
                - generic [ref=e151]:
                  - generic [ref=e152]:
                    - paragraph [ref=e153]: 覆核升級處理
                    - paragraph [ref=e154]: Iris Wong / +852 9333 2211 / 內部升級處理
                  - generic [ref=e155]: 草稿
                - paragraph [ref=e156]: Iris Wong，請在遞交前處理 Delta Bloom Ventures Limited 的「內部覆核未開始」。
                - generic [ref=e157]:
                  - paragraph [ref=e158]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e159]:
                - generic [ref=e160]:
                  - generic [ref=e161]:
                    - paragraph [ref=e162]: 交件套件提醒
                    - paragraph [ref=e163]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e164]: 草稿
                - paragraph [ref=e165]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「NAR1 draft prepared」仍未完成。
                - generic [ref=e166]:
                  - paragraph [ref=e167]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e168]:
                - generic [ref=e169]:
                  - generic [ref=e170]:
                    - paragraph [ref=e171]: 交件套件提醒
                    - paragraph [ref=e172]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e173]: 草稿
                - paragraph [ref=e174]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Company particulars checked」仍未完成。
                - generic [ref=e175]:
                  - paragraph [ref=e176]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e177]:
                - generic [ref=e178]:
                  - generic [ref=e179]:
                    - paragraph [ref=e180]: 交件套件提醒
                    - paragraph [ref=e181]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e182]: 草稿
                - paragraph [ref=e183]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Significant controller register confirmed」仍未完成。
                - generic [ref=e184]:
                  - paragraph [ref=e185]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e186]:
                - generic [ref=e187]:
                  - generic [ref=e188]:
                    - paragraph [ref=e189]: 交件套件提醒
                    - paragraph [ref=e190]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e191]: 草稿
                - paragraph [ref=e192]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Signed NAR1 attached」仍未完成。
                - generic [ref=e193]:
                  - paragraph [ref=e194]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e195]:
                - generic [ref=e196]:
                  - generic [ref=e197]:
                    - paragraph [ref=e198]: 交件套件提醒
                    - paragraph [ref=e199]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e200]: 草稿
                - paragraph [ref=e201]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Payment proof checked」仍未完成。
                - generic [ref=e202]:
                  - paragraph [ref=e203]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e204]:
                - generic [ref=e205]:
                  - generic [ref=e206]:
                    - paragraph [ref=e207]: 交件套件提醒
                    - paragraph [ref=e208]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e209]: 草稿
                - paragraph [ref=e210]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Internal filing review approved」仍未完成。
                - generic [ref=e211]:
                  - paragraph [ref=e212]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
          - generic [ref=e213]:
            - generic [ref=e214]:
              - generic [ref=e215]:
                - heading "清單" [level=2] [ref=e216]
                - paragraph [ref=e217]: 同事工作項目，隨工作推進或重開而更新。
              - generic [ref=e218]: 1/5
            - generic [ref=e219]:
              - button "Confirm company particulars 已完成" [disabled] [ref=e220]:
                - generic [ref=e221]: Confirm company particulars
                - generic [ref=e222]: 已完成
              - button "Collect signed NAR1 未完成" [disabled] [ref=e223]:
                - generic [ref=e224]: Collect signed NAR1
                - generic [ref=e225]: 未完成
              - button "Verify significant controller register 未完成" [disabled] [ref=e226]:
                - generic [ref=e227]: Verify significant controller register
                - generic [ref=e228]: 未完成
              - button "Confirm filing fee payment 未完成" [disabled] [ref=e229]:
                - generic [ref=e230]: Confirm filing fee payment
                - generic [ref=e231]: 未完成
              - button "Submit to Companies Registry 未完成" [disabled] [ref=e232]:
                - generic [ref=e233]: Submit to Companies Registry
                - generic [ref=e234]: 未完成
          - generic [ref=e235]:
            - generic [ref=e236]:
              - generic [ref=e237]:
                - heading "備註" [level=2] [ref=e238]
                - paragraph [ref=e239]: 同事就此案件記錄的背景資料。
              - generic [ref=e240]: 0 則備註
            - generic [ref=e241]:
              - textbox "新增備註" [ref=e242]
              - generic [ref=e243]:
                - button "加入備註" [disabled]
            - paragraph [ref=e245]: 暫時沒有備註。
        - generic [ref=e246]:
          - generic [ref=e247]:
            - generic [ref=e248]:
              - generic [ref=e249]:
                - heading "客戶入口活動" [level=2] [ref=e250]
                - paragraph [ref=e251]: 此案件的客戶操作及存檔記錄。
              - generic [ref=e252]: 2 項待處理
            - generic [ref=e253]:
              - generic [ref=e254]:
                - paragraph [ref=e256]: 待處理
                - paragraph [ref=e258]: "2"
              - generic [ref=e259]:
                - paragraph [ref=e261]: 存檔
                - paragraph [ref=e263]: "2"
              - generic [ref=e264]:
                - paragraph [ref=e266]: 最近活動
                - paragraph [ref=e268]: 沒有
            - generic [ref=e269]:
              - link "開啟存檔" [ref=e270] [cursor=pointer]:
                - /url: /documents?caseId=ar-delta
              - link "開啟客戶入口" [ref=e271] [cursor=pointer]:
                - /url: /portal?caseId=ar-delta
          - generic [ref=e272]:
            - generic [ref=e273]:
              - generic [ref=e274]:
                - heading "時間線" [level=2] [ref=e275]
                - paragraph [ref=e276]: 最新的案件活動排在最前。
              - generic [ref=e277]: 1 項事件
            - generic [ref=e279]:
              - generic [ref=e280]:
                - paragraph [ref=e281]: Case seeded
                - paragraph [ref=e282]: 2026年7月1日 17:00
              - paragraph [ref=e283]: Due-soon case blocked by documents, payment, and review.
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | import { expect, type Locator, type Page } from "@playwright/test";
  2   | 
  3   | // Existing fixture-backed demo only. 640 CSS px models the reflow space of a
  4   | // 1280px layout at 200%; it is NOT browser zoom, native Auth or backend UAT.
  5   | export const COMPANY = "Delta Bloom Ventures Limited";
  6   | export const CASE_PATH = "/annual-returns/ar-delta";
  7   | export const PERSONAS = [
  8   |   { name: "Amy Chan", role: "Admin", label: "管理員" },
  9   |   { name: "Mei Lam", role: "Staff", label: "同事" },
  10  | ] as const;
  11  | 
  12  | export async function assertKeyboardFocus(target: Locator) {
  13  |   await expect(target).toBeFocused();
  14  |   await expect(target).toBeInViewport();
  15  |   // Radix's drawer can be visible/focused during its 500ms entrance animation.
  16  |   // Wait for the same geometry/focus contract, rather than sampling mid-slide.
  17  |   await expect
  18  |     .poll(() =>
  19  |       target.evaluate((element) => {
  20  |         const style = getComputedStyle(element);
  21  |         const rect = element.getBoundingClientRect();
  22  |         return {
  23  |           visible: element.matches(":focus-visible"),
  24  |           cue:
  25  |             (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
  26  |             style.boxShadow !== "none",
  27  |           contained: rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1,
  28  |         };
  29  |       }),
  30  |     )
  31  |     .toEqual({ visible: true, cue: true, contained: true });
  32  |   const appearance = () =>
  33  |     target.evaluate((element) => {
  34  |       const style = getComputedStyle(element);
  35  |       return {
  36  |         outline: [style.outlineStyle, style.outlineWidth, style.outlineColor].join(" "),
  37  |         outlineVisible:
  38  |           style.outlineStyle !== "none" &&
  39  |           parseFloat(style.outlineWidth) > 0 &&
  40  |           !["transparent", "rgba(0, 0, 0, 0)"].includes(style.outlineColor),
  41  |         shadow: style.boxShadow,
  42  |       };
  43  |     });
  44  |   const focused = await appearance();
  45  |   // Compare the actual same control after a real Tab away; a permanent card
  46  |   // shadow/outline cannot be mistaken for a keyboard-specific indicator.
  47  |   await target.page().keyboard.press("Tab");
  48  |   await expect(target).not.toBeFocused();
  49  |   const unfocused = await appearance();
  50  |   await target.page().keyboard.press("Shift+Tab");
  51  |   await expect(target).toBeFocused();
  52  |   expect(
  53  |     (focused.outlineVisible && focused.outline !== unfocused.outline) ||
  54  |       (focused.shadow !== "none" && focused.shadow !== unfocused.shadow),
  55  |     "keyboard focus must change the outline/ring, not merely retain a decorative shadow",
  56  |   ).toBe(true);
  57  | }
  58  | 
  59  | /** Read-only fields/actions must remain readable, including inside clipped panels. */
  60  | export async function assertReadable(target: Locator) {
  61  |   await target.scrollIntoViewIfNeeded();
  62  |   await expect(target).toBeInViewport();
  63  |   const geometry = await target.evaluate((element) => {
  64  |     const rect = element.getBoundingClientRect();
  65  |     const clipping: string[] = [];
  66  |     for (
  67  |       let parent = element.parentElement;
  68  |       parent && parent !== document.body;
  69  |       parent = parent.parentElement
  70  |     ) {
  71  |       const style = getComputedStyle(parent);
  72  |       const box = parent.getBoundingClientRect();
  73  |       if (style.overflowX !== "visible" && (rect.left < box.left - 1 || rect.right > box.right + 1))
  74  |         clipping.push("horizontal");
  75  |       if (style.overflowY !== "visible" && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1))
  76  |         clipping.push("vertical");
  77  |     }
  78  |     const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  79  |     return {
  80  |       clipping,
  81  |       viewport: rect.left >= -1 && rect.right <= innerWidth + 1,
  82  |       unobscured: hit === element || (!!hit && element.contains(hit)),
  83  |       ownTextFits: element.scrollWidth <= element.clientWidth + 1,
  84  |     };
  85  |   });
> 86  |   expect(geometry).toEqual({ clipping: [], viewport: true, unobscured: true, ownTextFits: true });
      |                    ^ Error: expect(received).toEqual(expected) // deep equality
  87  | }
  88  | 
  89  | // Find the real sequential tab stop, rather than using locator.focus() to make
  90  | // an otherwise unreachable control look keyboard accessible.
  91  | export async function tabTo(page: Page, target: Locator) {
  92  |   await expect(target).toBeVisible();
  93  |   for (let count = 0; count < 80; count++) {
  94  |     if (await target.evaluate((element) => element === document.activeElement)) {
  95  |       await assertKeyboardFocus(target);
  96  |       return;
  97  |     }
  98  |     await page.keyboard.press("Tab");
  99  |   }
  100 |   throw new Error(`Target was not reached within 80 Tab presses: ${target.toString()}`);
  101 | }
  102 | 
  103 | export async function activate(page: Page, target: Locator) {
  104 |   await tabTo(page, target);
  105 |   await page.keyboard.press("Enter");
  106 | }
  107 | 
  108 | export async function openNavigation(page: Page) {
  109 |   const trigger = page.getByRole("button", { name: "開啟導覽選單", exact: true });
  110 |   if (await trigger.isVisible()) {
  111 |     await activate(page, trigger);
  112 |     await expect(page.getByRole("dialog", { name: "導覽", exact: true })).toBeVisible();
  113 |   }
  114 |   const nav = page.getByRole("navigation", { name: "主要導覽", exact: true });
  115 |   await expect(nav).toBeVisible();
  116 |   return nav;
  117 | }
  118 | 
  119 | export async function assertReflow(page: Page, width: number) {
  120 |   await expect(page.getByRole("main")).toBeVisible();
  121 |   const geometry = await page.evaluate(() => ({
  122 |     viewport: window.innerWidth,
  123 |     document: document.documentElement.scrollWidth,
  124 |     body: document.body.scrollWidth,
  125 |   }));
  126 |   expect(geometry.viewport).toBe(width);
  127 |   expect(geometry.document, "document must not scroll horizontally").toBeLessThanOrEqual(width + 1);
  128 |   expect(geometry.body, "body must not scroll horizontally").toBeLessThanOrEqual(width + 1);
  129 |   const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
  130 |   expect(heading).not.toBeNull();
  131 |   expect(heading!.x).toBeGreaterThanOrEqual(-1);
  132 |   expect(heading!.x + heading!.width).toBeLessThanOrEqual(width + 1);
  133 | }
  134 | 
  135 | export async function assertReadonlyDelta(page: Page) {
  136 |   await expect(page).toHaveURL(new RegExp(`${CASE_PATH}$`));
  137 |   const main = page.getByRole("main");
  138 |   await expect(main.getByRole("heading", { level: 1, name: COMPANY, exact: true })).toBeVisible();
  139 |   await expect(main).toContainText("Joanna Poon · +852 9333 2211");
  140 |   await expect(main).toContainText("等待文件");
  141 |   await expect(main.getByRole("combobox", { name: "分配負責同事" })).toHaveValue("Iris Wong");
  142 |   for (const [label, value] of [
  143 |     ["付款", "pending"],
  144 |     ["簽署", "requested"],
  145 |     ["覆核", "not-started"],
  146 |   ]) {
  147 |     const control = main.getByRole("combobox", { name: label, exact: true });
  148 |     await expect(control).toBeDisabled();
  149 |     await expect(control).toHaveValue(value);
  150 |   }
  151 |   const blockers = main.locator("section").filter({
  152 |     has: page.getByRole("heading", { name: "阻礙事項", exact: true }),
  153 |   });
  154 |   await expect(blockers).toContainText("Signed NAR1");
  155 |   await expect(blockers).toContainText("Updated significant controller register");
  156 |   await expect(blockers.getByRole("button", { name: "標記為已收到", exact: true })).toHaveCount(2);
  157 |   expect(await main.locator("button, select").count()).toBeGreaterThan(10);
  158 |   await expect(main.locator("button:enabled, select:enabled")).toHaveCount(0);
  159 |   await expect(main.getByRole("button", { name: "遞交交件套件", exact: true })).toBeDisabled();
  160 |   await expect(main.getByRole("button", { name: "接納回條", exact: true })).toBeDisabled();
  161 |   await expect(main.getByRole("button", { name: "加入備註", exact: true })).toBeDisabled();
  162 |   const note = main.getByRole("textbox", { name: "新增備註", exact: true });
  163 |   await expect(note).toHaveAttribute("readonly", "");
  164 |   await expect(note).toHaveValue("");
  165 |   await expect(main.getByText("暫時沒有備註。", { exact: true })).toBeVisible();
  166 |   await expect(main.getByText("Case seeded", { exact: true })).toBeVisible();
  167 |   await expect(main.getByRole("status")).toContainText("唯讀示範。案件狀態只可在正式環境");
  168 |   return main.locator("select, textarea").evaluateAll((elements) =>
  169 |     elements.map((element) => {
  170 |       const control = element as HTMLSelectElement | HTMLTextAreaElement;
  171 |       return { value: control.value, disabled: control.disabled };
  172 |     }),
  173 |   );
  174 | }
  175 | 
```