# UI language

Kossilon's interface is written in **Traditional Chinese (Hong Kong)**. The navigation
was already Chinese while page titles, tables and buttons were English, so a single
screen often mixed both ("待核對文件（份）" beside "Payment pending"). Every
user-facing string now follows the rules below.

## Rules

- **All UI copy is 繁體中文（香港）**: page titles and eyebrows, subtitles, table
  headers, buttons, links, filters and their options, placeholders, empty and loading
  states, notices, toasts, `aria-label`s and `title`s. Use full-width punctuation
  （，。：；「」） in Chinese sentences.
- **Keep in English**: proper nouns and product names (WhatsApp, Google, Neon, R2),
  statutory form codes (NAR1, ND2A, NNC1, BR), the abbreviation SLA, file names, email
  addresses, phone numbers, and all data values (company and person names come from
  records).
- **Do not translate code contracts**: error prefixes `Forbidden:` / `Unauthorized:`,
  enum values, query keys, URL paths, test ids, log lines, server-function error text
  that is matched in code.
- **Eyebrows name the sidebar group** the screen belongs to (`PageHeader` documents
  this): 今日工作 · 案件與客戶 · 文件與付款 · 通訊 · 管理. The client portal uses 客戶入口.
- **Page titles match the sidebar label** exactly (總覽, 工作隊列, 周年申報, 客戶, 公司註冊,
  公司變更, 月表匯入, 文件, 付款, 客戶入口, WhatsApp 收件箱, WhatsApp 追件, 用戶管理,
  系統運作, 設定).
- Dates use `formatDate` / `formatDueDate` from `src/lib/format-date.ts`.

## Glossary

| English                          | 繁中                       |
| -------------------------------- | -------------------------- |
| Dashboard                        | 總覽                       |
| Annual return (case)             | 周年申報（案件）           |
| Case                             | 案件                       |
| Filing / file (verb)             | 遞交                       |
| Filed                            | 已遞交                     |
| Ready to file                    | 可遞交                     |
| Due date / due                   | 到期日 / 到期              |
| Overdue                          | 已逾期                     |
| Due soon                         | 即將到期                   |
| Blocked / blocker                | 受阻 / 阻礙事項            |
| Packet (filing packet)           | 交件套件                   |
| Readiness                        | 完成度                     |
| Owner                            | 負責同事                   |
| Reviewer / review                | 覆核人 / 覆核              |
| Verify / check                   | 核對                       |
| Accept / accepted                | 接納 / 已接納              |
| Reject / rejected                | 退回 / 已退回              |
| Follow-up                        | 跟進                       |
| Next action                      | 下一步                     |
| Payment / payment proof          | 付款 / 付款證明            |
| Paid / pending / overdue (pay)   | 已付款 / 待付款 / 逾期未付 |
| Client / contact                 | 客戶 / 聯絡人              |
| Director / shareholder           | 董事 / 股東                |
| Company secretary                | 公司秘書                   |
| Significant controllers register | 重要控制人登記冊           |
| Companies Registry               | 公司註冊處                 |
| Incorporation                    | 公司註冊                   |
| Corporate change                 | 公司變更                   |
| Work queue / work item           | 工作隊列 / 工作項目        |
| Assign / unassigned              | 分配 / 未分配              |
| At risk / breached (SLA)         | 有風險 / 已逾時            |
| Escalate / acknowledge           | 升級處理 / 確認知悉        |
| Priority                         | 優先次序                   |
| Status                           | 狀態                       |
| Template                         | 模板                       |
| Settings                         | 設定                       |
| Search / filter / all            | 搜尋 / 篩選 / 全部         |
| Open (a record)                  | 開啟                       |
| Save / cancel / confirm          | 儲存 / 取消 / 確認         |
| Upload / download / preview      | 上載 / 下載 / 預覽         |
| Loading…                         | 載入中…                    |
| Sign in / sign out               | 登入 / 登出                |
| Read-only demo                   | 唯讀示範                   |
| Team / staff                     | 團隊 / 同事                |
| Activate / deactivate            | 啟用 / 停用                |
| Timeline / events                | 時間線 / 事件              |
| Unavailable                      | 無法使用 / 無法載入        |
