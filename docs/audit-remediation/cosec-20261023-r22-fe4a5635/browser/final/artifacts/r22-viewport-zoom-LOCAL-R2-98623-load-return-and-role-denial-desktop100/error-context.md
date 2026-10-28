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
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - generic [ref=e5]:
        - generic [ref=e6]: K
        - generic [ref=e8]:
          - generic [ref=e9]: Kossilon
          - generic [ref=e10]: CoSec OS
      - navigation "主要導覽" [ref=e11]:
        - generic [ref=e12]:
          - generic [ref=e13]:
            - generic [ref=e14]: 今日工作
            - list [ref=e15]:
              - listitem [ref=e16]:
                - link "今日工作" [ref=e17] [cursor=pointer]:
                  - /url: /today
              - listitem [ref=e23]:
                - link "總覽" [ref=e24] [cursor=pointer]:
                  - /url: /
              - listitem [ref=e31]:
                - link "工作隊列" [ref=e32] [cursor=pointer]:
                  - /url: /work-queue
          - generic [ref=e37]:
            - generic [ref=e38]: 案件與客戶
            - list [ref=e39]:
              - listitem [ref=e40]:
                - link "周年申報" [ref=e41] [cursor=pointer]:
                  - /url: /annual-returns
              - listitem [ref=e47]:
                - link "客戶" [ref=e48] [cursor=pointer]:
                  - /url: /clients
              - listitem [ref=e54]:
                - link "公司註冊" [ref=e55] [cursor=pointer]:
                  - /url: /incorporation
              - listitem [ref=e62]:
                - link "公司變更" [ref=e63] [cursor=pointer]:
                  - /url: /corporate-changes
              - listitem [ref=e70]:
                - link "月表匯入" [ref=e71] [cursor=pointer]:
                  - /url: /imports
          - generic [ref=e76]:
            - generic [ref=e77]: 文件與付款
            - list [ref=e78]:
              - listitem [ref=e79]:
                - link "文件" [ref=e80] [cursor=pointer]:
                  - /url: /documents
              - listitem [ref=e85]:
                - link "付款" [ref=e86] [cursor=pointer]:
                  - /url: /payments
              - listitem [ref=e90]:
                - link "客戶入口" [ref=e91] [cursor=pointer]:
                  - /url: /portal
          - generic [ref=e97]:
            - generic [ref=e98]: 通訊
            - list [ref=e99]:
              - listitem [ref=e100]:
                - link "WhatsApp 收件箱" [ref=e101] [cursor=pointer]:
                  - /url: /whatsapp
              - listitem [ref=e105]:
                - link "WhatsApp 追件" [ref=e106] [cursor=pointer]:
                  - /url: /whatsapp/automation
          - generic [ref=e110]:
            - generic [ref=e111]: 管理
            - list [ref=e112]:
              - listitem [ref=e113]:
                - link "用戶管理" [ref=e114] [cursor=pointer]:
                  - /url: /admin
              - listitem [ref=e119]:
                - link "系統運作" [ref=e120] [cursor=pointer]:
                  - /url: /operations
              - listitem [ref=e124]:
                - link "設定" [ref=e125] [cursor=pointer]:
                  - /url: /settings
      - generic [ref=e130]:
        - generic [ref=e131]: AC
        - generic [ref=e132]:
          - generic [ref=e133]: Amy Chan
          - generic [ref=e134]: 管理員
        - button "登出" [ref=e135]
    - main [ref=e140]:
      - generic [ref=e141]:
        - generic [ref=e142]:
          - paragraph [ref=e143]: 案件與客戶
          - heading "Delta Bloom Ventures Limited" [level=1] [ref=e144]
          - paragraph [ref=e145]: Joanna Poon · +852 9333 2211 · 申報基準日 2026年6月4日
        - generic [ref=e146]:
          - link "返回" [ref=e147] [cursor=pointer]:
            - /url: /annual-returns
          - link "分配及 SLA" [ref=e148] [cursor=pointer]:
            - /url: /work-queue?view=team&owner=all&workType=all&sla=all&priority=all&status=all
      - status [ref=e149]: 唯讀示範。案件狀態只可在正式環境經周年申報伺服器操作更改。
      - generic [ref=e151]:
        - generic [ref=e152]:
          - generic [ref=e154]:
            - generic [ref=e155]: 已逾期
            - generic [ref=e157]: 等待文件
          - generic [ref=e158]:
            - generic [ref=e159]:
              - paragraph [ref=e161]: 到期日
              - paragraph [ref=e163]: 2026年7月15日 · 已逾期 100 日
            - generic [ref=e164]:
              - paragraph [ref=e166]: 完成度
              - paragraph [ref=e168]: 0%
            - generic [ref=e169]:
              - paragraph [ref=e171]: 下一步
              - paragraph [ref=e173]: 索取 Signed NAR1
            - generic [ref=e174]:
              - paragraph [ref=e176]: 阻礙事項
              - paragraph [ref=e178]: 5 項未解決
        - generic [ref=e180]:
          - text: 負責同事
          - combobox "分配負責同事" [disabled] [ref=e181]:
            - option "Iris Wong" [selected]
            - option "Calvin Ho"
            - option "Mandy Lee"
            - option "Operations"
      - generic [ref=e182]:
        - generic [ref=e183]:
          - generic [ref=e184]:
            - generic [ref=e185]:
              - generic [ref=e186]:
                - heading "阻礙事項" [level=2] [ref=e187]
                - paragraph [ref=e188]: 拖低完成度的文件、付款、簽署及覆核阻礙事項。
              - generic [ref=e189]: 5 項未解決
            - generic [ref=e190]:
              - generic [ref=e191]:
                - generic [ref=e192]:
                  - paragraph [ref=e193]: Signed NAR1
                  - paragraph [ref=e194]: 缺少
                - button "標記為已收到" [disabled]
              - generic [ref=e195]:
                - generic [ref=e196]:
                  - paragraph [ref=e197]: Updated significant controller register
                  - paragraph [ref=e198]: 缺少
                - button "標記為已收到" [disabled]
            - generic [ref=e199]:
              - generic [ref=e200]:
                - text: 付款
                - combobox "付款" [disabled] [ref=e201]:
                  - option "待付款" [selected]
                  - option "已付款"
                  - option "逾期未付"
              - generic [ref=e202]:
                - text: 簽署
                - combobox "簽署" [disabled] [ref=e203]:
                  - option "缺少"
                  - option "已要求" [selected]
                  - option "已收到"
              - generic [ref=e204]:
                - text: 覆核
                - combobox "覆核" [disabled] [ref=e205]:
                  - option "未開始" [selected]
                  - option "覆核中"
                  - option "已批准"
          - generic [ref=e206]:
            - generic [ref=e207]:
              - generic [ref=e208]:
                - heading "交件套件" [level=2] [ref=e209]
                - paragraph [ref=e210]: 示範 NAR1 交件套件於遞交前的現況。
              - generic [ref=e211]:
                - generic [ref=e212]: 未開始
                - paragraph [ref=e213]: 交件套件完成度 0%
            - generic [ref=e214]:
              - button "NAR1 draft prepared 未完成" [disabled] [ref=e215]:
                - generic [ref=e216]: NAR1 draft prepared
                - generic [ref=e217]: 未完成
              - button "Company particulars checked 未完成" [disabled] [ref=e218]:
                - generic [ref=e219]: Company particulars checked
                - generic [ref=e220]: 未完成
              - button "Significant controller register confirmed 未完成" [disabled] [ref=e221]:
                - generic [ref=e222]: Significant controller register confirmed
                - generic [ref=e223]: 未完成
              - button "Signed NAR1 attached 未完成" [disabled] [ref=e224]:
                - generic [ref=e225]: Signed NAR1 attached
                - generic [ref=e226]: 未完成
              - button "Payment proof checked 未完成" [disabled] [ref=e227]:
                - generic [ref=e228]: Payment proof checked
                - generic [ref=e229]: 未完成
              - button "Internal filing review approved 未完成" [disabled] [ref=e230]:
                - generic [ref=e231]: Internal filing review approved
                - generic [ref=e232]: 未完成
            - generic [ref=e233]:
              - button "遞交交件套件" [disabled]
              - button "接納回條" [disabled]
          - generic [ref=e234]:
            - generic [ref=e235]:
              - generic [ref=e236]:
                - heading "跟進" [level=2] [ref=e237]
                - paragraph [ref=e238]: 按目前阻礙事項產生的示範 WhatsApp 提醒。
              - generic [ref=e239]: 11 項待跟進
            - generic [ref=e240]:
              - generic [ref=e241]:
                - generic [ref=e242]:
                  - generic [ref=e243]:
                    - paragraph [ref=e244]: 索取缺少文件
                    - paragraph [ref=e245]: Joanna Poon / +852 9333 2211 / 今日發送
                  - generic [ref=e246]: 草稿
                - paragraph [ref=e247]: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「Signed NAR1」待處理，完成後我們即可遞交。
                - generic [ref=e248]:
                  - paragraph [ref=e249]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e250]:
                - generic [ref=e251]:
                  - generic [ref=e252]:
                    - paragraph [ref=e253]: 索取缺少文件
                    - paragraph [ref=e254]: Joanna Poon / +852 9333 2211 / 今日發送
                  - generic [ref=e255]: 草稿
                - paragraph [ref=e256]: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「Updated significant controller register」待處理，完成後我們即可遞交。
                - generic [ref=e257]:
                  - paragraph [ref=e258]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e259]:
                - generic [ref=e260]:
                  - generic [ref=e261]:
                    - paragraph [ref=e262]: 付款提醒
                    - paragraph [ref=e263]: Joanna Poon / +852 9333 2211 / 今日發送
                  - generic [ref=e264]: 草稿
                - paragraph [ref=e265]: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「待付款」待處理，完成後我們即可遞交。
                - generic [ref=e266]:
                  - paragraph [ref=e267]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e268]:
                - generic [ref=e269]:
                  - generic [ref=e270]:
                    - paragraph [ref=e271]: 簽署提醒
                    - paragraph [ref=e272]: Joanna Poon / +852 9333 2211 / 下午 5 時前發送
                  - generic [ref=e273]: 草稿
                - paragraph [ref=e274]: Joanna Poon 你好，我們是 Kossilon。Delta Bloom Ventures Limited 的周年申報尚有「已要求簽署」待處理，完成後我們即可遞交。
                - generic [ref=e275]:
                  - paragraph [ref=e276]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e277]:
                - generic [ref=e278]:
                  - generic [ref=e279]:
                    - paragraph [ref=e280]: 覆核升級處理
                    - paragraph [ref=e281]: Iris Wong / +852 9333 2211 / 內部升級處理
                  - generic [ref=e282]: 草稿
                - paragraph [ref=e283]: Iris Wong，請在遞交前處理 Delta Bloom Ventures Limited 的「內部覆核未開始」。
                - generic [ref=e284]:
                  - paragraph [ref=e285]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e286]:
                - generic [ref=e287]:
                  - generic [ref=e288]:
                    - paragraph [ref=e289]: 交件套件提醒
                    - paragraph [ref=e290]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e291]: 草稿
                - paragraph [ref=e292]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「NAR1 draft prepared」仍未完成。
                - generic [ref=e293]:
                  - paragraph [ref=e294]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e295]:
                - generic [ref=e296]:
                  - generic [ref=e297]:
                    - paragraph [ref=e298]: 交件套件提醒
                    - paragraph [ref=e299]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e300]: 草稿
                - paragraph [ref=e301]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Company particulars checked」仍未完成。
                - generic [ref=e302]:
                  - paragraph [ref=e303]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e304]:
                - generic [ref=e305]:
                  - generic [ref=e306]:
                    - paragraph [ref=e307]: 交件套件提醒
                    - paragraph [ref=e308]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e309]: 草稿
                - paragraph [ref=e310]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Significant controller register confirmed」仍未完成。
                - generic [ref=e311]:
                  - paragraph [ref=e312]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e313]:
                - generic [ref=e314]:
                  - generic [ref=e315]:
                    - paragraph [ref=e316]: 交件套件提醒
                    - paragraph [ref=e317]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e318]: 草稿
                - paragraph [ref=e319]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Signed NAR1 attached」仍未完成。
                - generic [ref=e320]:
                  - paragraph [ref=e321]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e322]:
                - generic [ref=e323]:
                  - generic [ref=e324]:
                    - paragraph [ref=e325]: 交件套件提醒
                    - paragraph [ref=e326]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e327]: 草稿
                - paragraph [ref=e328]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Payment proof checked」仍未完成。
                - generic [ref=e329]:
                  - paragraph [ref=e330]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
              - generic [ref=e331]:
                - generic [ref=e332]:
                  - generic [ref=e333]:
                    - paragraph [ref=e334]: 交件套件提醒
                    - paragraph [ref=e335]: Iris Wong / +852 9333 2211 / 遞交前覆核
                  - generic [ref=e336]: 草稿
                - paragraph [ref=e337]: Iris Wong，Delta Bloom Ventures Limited 的交件套件項目「Internal filing review approved」仍未完成。
                - generic [ref=e338]:
                  - paragraph [ref=e339]: 按目前阻礙事項草擬
                  - button "立即發送" [disabled]
          - generic [ref=e340]:
            - generic [ref=e341]:
              - generic [ref=e342]:
                - heading "清單" [level=2] [ref=e343]
                - paragraph [ref=e344]: 同事工作項目，隨工作推進或重開而更新。
              - generic [ref=e345]: 1/5
            - generic [ref=e346]:
              - button "Confirm company particulars 已完成" [disabled] [ref=e347]:
                - generic [ref=e348]: Confirm company particulars
                - generic [ref=e349]: 已完成
              - button "Collect signed NAR1 未完成" [disabled] [ref=e350]:
                - generic [ref=e351]: Collect signed NAR1
                - generic [ref=e352]: 未完成
              - button "Verify significant controller register 未完成" [disabled] [ref=e353]:
                - generic [ref=e354]: Verify significant controller register
                - generic [ref=e355]: 未完成
              - button "Confirm filing fee payment 未完成" [disabled] [ref=e356]:
                - generic [ref=e357]: Confirm filing fee payment
                - generic [ref=e358]: 未完成
              - button "Submit to Companies Registry 未完成" [disabled] [ref=e359]:
                - generic [ref=e360]: Submit to Companies Registry
                - generic [ref=e361]: 未完成
          - generic [ref=e362]:
            - generic [ref=e363]:
              - generic [ref=e364]:
                - heading "備註" [level=2] [ref=e365]
                - paragraph [ref=e366]: 同事就此案件記錄的背景資料。
              - generic [ref=e367]: 0 則備註
            - generic [ref=e368]:
              - textbox "新增備註" [ref=e369]
              - generic [ref=e370]:
                - button "加入備註" [disabled]
            - paragraph [ref=e372]: 暫時沒有備註。
        - generic [ref=e373]:
          - generic [ref=e374]:
            - generic [ref=e375]:
              - generic [ref=e376]:
                - heading "客戶入口活動" [level=2] [ref=e377]
                - paragraph [ref=e378]: 此案件的客戶操作及存檔記錄。
              - generic [ref=e379]: 2 項待處理
            - generic [ref=e380]:
              - generic [ref=e381]:
                - paragraph [ref=e383]: 待處理
                - paragraph [ref=e385]: "2"
              - generic [ref=e386]:
                - paragraph [ref=e388]: 存檔
                - paragraph [ref=e390]: "2"
              - generic [ref=e391]:
                - paragraph [ref=e393]: 最近活動
                - paragraph [ref=e395]: 沒有
            - generic [ref=e396]:
              - link "開啟存檔" [ref=e397] [cursor=pointer]:
                - /url: /documents?caseId=ar-delta
              - link "開啟客戶入口" [ref=e398] [cursor=pointer]:
                - /url: /portal?caseId=ar-delta
          - generic [ref=e399]:
            - generic [ref=e400]:
              - generic [ref=e401]:
                - heading "時間線" [level=2] [ref=e402]
                - paragraph [ref=e403]: 最新的案件活動排在最前。
              - generic [ref=e404]: 1 項事件
            - generic [ref=e406]:
              - generic [ref=e407]:
                - paragraph [ref=e408]: Case seeded
                - paragraph [ref=e409]: 2026年7月1日 17:00
              - paragraph [ref=e410]: Due-soon case blocked by documents, payment, and review.
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