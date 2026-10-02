# Kossilon Hub — Codex GPT‑6.1 Sol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use a single execution thread by default; delegation is optional only when explicitly authorised.

**Goal:** 按 2026-10-01 審計證據修復日常工作、支援流程、Admin、文件、付款、批量維護與效能，並以可重現測試及真實環境證據驗收。

**Architecture:** 保留 TanStack Start/Router/Query + React、Postgres repository、Neon Auth、R2、Cloudflare scheduled maintenance、WOZTELL outbox。先統一資料／權限／readiness，再擴充批量與整合。無須改用 Next.js、ORM 或另建後台。

**Tech Stack:** TypeScript strict、React 19、Vite、Tailwind/shadcn、postgres.js、Vitest/Testing Library；CI 的 Bun frozen lockfile、Node 22、Postgres 17。以上是審計快照，T00以最新repo為準。

**Spec:** `Kossilon_Audit_Evidence_2026-10-01.zip` 內的 audit Markdown、50項UAT CSV、source-index、UI證據、pagination regression及baseline logs。本計劃基於已驗ZIP完整性及內部hash的證據包；不是一次新的live audit。

**Audit commit:** `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`。Live deployment SHA 在審計時未確認；不可假設 Git main、Web、Worker 完全相同。

**Repository:** https://github.com/YNWAforever/kossilon-hub  
**Website:** https://kossilon-hub.vercel.app/  
**Prepared:** 2026-10-01；目標執行模型由使用者在 Codex 選擇 GPT‑6.1 Sol。

本文件是實施規格，未聲稱任何修復、部署或重新UAT已完成。不要把新功能的mock pass當作外部服務已接通。

## Global Constraints

1. 先讀 repo `AGENTS.md` 及最新適用指示；Lovable連接分支不可force push／改寫已發布歷史。所有工作用小型可驗收commit，依依賴拆PR；保留使用者既有修改。
2. 本次交付是計劃。使用者把啟動指令交給Codex後才開始實施；按當時已授權範圍推進。沒有正式部署／外發授權時仍完成code、隔離測試、draft PR及部署包，不因缺一個credential停下全部工作。
3. 權限由server決定；Admin也須active。沿用Admin/Manager/Staff/Client四角色；「Finance」「Reviewer」「DevOps」是測試職責，不能默默新增高權限role。先把每個persona映射到現有允許能力。
4. DB正式修復先讀取inventory、確認DB branch與backup restore演練。只作可追溯forward migration；不reset/reseed、刪ledger、改歷史migration。新檔序號取最新main下一號，不硬編0035；同步schema manifest/health及相關fixture。
5. 任何批量mutation都有server preview、逐筆授權、版本檢查、idempotency與audit。未知派送不能盲目retry；fixtures/historical不能外發。測試不寄真客戶訊息／邀請。
6. Document scan、case approval、payment verification、handoff receipt是不同事實。缺證據保持unknown；AI不能自動批准，匯出套件不等於送出，provider accepted不等於delivered。
7. HK business date沿用既有date utilities；不要用瀏覽器UTC切日替代。機密留server，報告/測試日誌不列token、signed URL或個人資料。只用合成或核准脫敏fixture。
8. 既有adapter、tests和types優先擴充；以下Create路徑是建議新增位置，T00發現已有等價能力就重用。每個task列出的檔案是責任邊界，不是盲目覆寫清單。
9. 修bug先有重現測試；新能力先鎖定acceptance contract再實作。文件／純低風險樣式改動毋須為了湊數加鏡像測試。只為具體風險補驗證。
10. 外部provider只依官方文件與實際授權協定；無credential可完成adapter/mock contract，但live gate保持blocked。不要創造WOZTELL媒體端點、Neon邀請API或handoff目的地。

## Review Focus

| 最容易失敗的邊界 | 必須保留的測試 | 測試負責任務 |
|---|---|---|
| Ledger看似修好，實體DDL仍缺；worker恢復後重送 | populated migration、dispatch接受後timeout、3次真scheduled tick | T01、T02、T17 |
| list/ID/bulk/Client的權限不一致 | scope矩陣、inactive session、越權零寫入 | T05、T12、T13 |
| 文件齊就誤當可交；V1批准套到V2 | 分階段readiness、concurrent evidence/payment update | T08、T11、T15、T19 |
| 分頁／filter／全選／retry造成重複或誤改 | null cursor終點、slow response、1240/50 scope、kill/resume | T07、T13、T14 |
| mock、empty或舊數據被呈現成healthy／成功 | unknown/error區分、provider receipt、golden evidence、fresh login | T16、T17、T23、T22 |

## 實施與發布次序

| PR包 | 任務 | 可交付結果 | 發布條件 |
|---|---|---|---|
| PR01 | T00、T01、T03 | baseline、schema與origin診斷／保護 | 無破壞性自動修復；正式DB另走核對 |
| PR02 | T02、T23 | scheduler與真實Operations狀態 | code可先合併；正式dispatch另有gate |
| PR03 | T04、T05、T06、T07 | Portal、文件可見性、權限及分頁修復 | scope與回歸測試通過 |
| PR04 | T08、T09、T10、T11 | readiness、指標、分派、付款review | current-version／交易測試通過 |
| PR05 | T12、T13 | Admin維護與批量分派 | last-admin及bulk並發測試通過 |
| PR06 | T14 | 月表逐行套用 | populated／重播／部分成功測試 |
| PR07 | T15、T16 | scanner、內容分析與AI | scanner和AI可分開發布；真連接分開驗收 |
| PR08 | T17、T18 | WhatsApp閉環及批量維護 | 真recipient測試需核准；draft功能可先用 |
| PR09 | T19 | 人工交件／回件與目的地adapter | 人工功能不假稱自動connector已完成 |
| PR10 | T20、T21 | 導覽設定UX及效能 | mobile/keyboard及scale基線 |
| PR11 | T22 | 50項UAT與release evidence | 本次release的所有關鍵gate通過 |

PR包是review邊界，可按大小再拆；不可把全部24任務做成一個巨型PR。任務號用於追蹤，T23屬早期共同工作。T02正式恢復不必等所有AI功能，但啟用哪些pass必須與schema／掃描／派送實際能力相符。

## 外部依賴台賬

| 依賴 | 需要的證據／資源 | 缺少時仍可完成 | 只阻擋甚麼 |
|---|---|---|---|
| Live DB / Web / Worker | 部署SHA、DB branch、read-only catalog/ledger、backup及cron設定 | T01診斷工具、T02測試、所有本地bugfix | 正式migration與scheduler啟用驗收 |
| Auth測試環境 | Admin/Staff/Client測試帳戶、callback與provider邀請支援 | 管理UI、server權限、mock登入契約 | fresh magic-link/Google、真邀請測試 |
| R2 / scanner | 隔離bucket、scanner endpoint與憑證、核准樣本 | quarantine/version邏輯、mock adapter測試 | 真scan閉環及安全文件功能release |
| OCR / AI | 核准provider、資料處理要求、測試額度 | 提取／unknown／human review、golden與mock | 真模型效果/延遲驗收 |
| WOZTELL | API_BASE_URL、ACCESS_TOKEN、CHANNEL_ID、WEBHOOK_SECRET；官方media協定、測試recipient | 設定UI、draft、mapping、adapter契約、outbox fault測試 | 真收發／receipt／媒體下載驗收 |
| Handoff目的地 | protocol、地址、權限、冪等與查receipt能力 | approved export、manual紀錄、mock return | 真自動交件／回件驗收 |

台賬必須列owner、缺項、可提供的方法和下一步；不要把「BLOCKED」當完成，也不要因此停止無依賴的工作。

## 任務規格

每項先核對最新程式；若already fixed，用現有test＋證據結案，不重寫。每次提交前檢查diff、只stage本任務檔案。下列測試路徑是精確目標；command使用 `npm run test -- <path>`，檔名含shell特殊字元時加引號。DB測試必須有隔離TEST_DATABASE_URL。

### T00 — 建立最新基線及執行台賬

**對應：** F01, F02, F20　**依賴：** 無　**類型：** 調查／工程準備

**檔案：**
- Read: `AGENTS.md`
- Read: `.github/workflows/ci.yml`
- Read: `package.json`
- Create: `docs/superpowers/plans/2026-10-01-kossilon-audit-remediation.md`
- Create: `docs/audit-remediation/status.md`
- Create: `docs/audit-remediation/environment-matrix.md`

**契約／責任：** 台賬每項包含 finding、task、commit、測試命令、結果、證據路徑、環境、外部 blocker、下一步；狀態限 pending/in_progress/code_verified/staging_verified/production_verified/blocked/not_applicable_with_evidence。

- [ ] **1. 重現／鎖定驗收：** 先驗 ZIP 的 SHA256SUMS.json；讀 audit、UAT、source-index 及 pagination reproducer。fetch 最新 main，記錄差異及工作區既有修改；不要覆寫使用者修改。核對審計 SHA 與目前 SHA，逐 F01–F20 記 still-present/fixed/needs-runtime-evidence。
- [ ] **2. 實作：** 開隔離分支或 worktree。依現有 CI 使用 Bun frozen lockfile 安裝，維持 Node 22 與既有工具鏈，除非最新 repo 已改。盤點 Web、Worker、DB branch、Auth、R2、scanner、AI、WOZTELL、handoff 的環境關聯，僅記標識及設定是否存在，不輸出 secrets。複製本計劃入 repo，建立 status。
- [ ] **3. 驗證：** 執行 npm run typecheck、npm run lint、npm run test、npm run build、npm run verify:firm -- --dry-run。隔離 Postgres 依 CI 設 DATABASE_URL 和 TEST_DATABASE_URL、DATABASE_SSL；migrate/seed 僅可指向可丟棄測試 DB。記錄 pass/fail/skip 實際數字；沒有 DB 時明列 integration 未跑。
- [ ] **4. 收尾／提交：** 基線可重現；已修復 finding 連同 regression evidence 標記，不重寫。未有 live credentials 不阻擋 T04/T07 等本地工作。提交 docs: record remediation baseline。

### T01 — 核對 migration ledger 與實體 schema

**對應：** F01　**依賴：** T00　**類型：** P0 調查＋修復

**檔案：**
- Modify: `src/features/operations/schema-health.ts`
- Modify: `scripts/db-migrate.ts`
- Read: `db/migrations/0034_notification_outbox_dispatch_marker.sql`
- Modify/Test: `src/features/operations/schema-health.test.ts`
- Create: `scripts/audit-schema-readiness.ts`
- Create/Test: `scripts/audit-schema-readiness.test.ts`
- Create: `docs/audit-remediation/schema-reconciliation.md`

**契約／責任：** 新增唯讀 auditSchemaReadiness 回傳 expected IDs、recorded IDs、可取得的 hash、column/index evidence、drift classification；不把 unknown ID 等同 SQL 缺失。既有 ledger 無 hash 時回 unknown，不能虛構。

- [ ] **1. 重現／鎖定驗收：** 測試：缺 ledger 但 DDL 已在、ledger 存在但 column 缺失、相同 basename 的歷史別名、未識別 migration；四者要分開。以 populated clone 重現 0034 缺失對 outbox query 的影響。
- [ ] **2. 實作：** 查 information_schema/pg_catalog 與 migration history；將 34/66/33 數字視為審計快照。逐項列出證據和 forward-only 修復 SQL；歷史 alias 只在證明等價後建立可追溯 reconciliation。不要刪 ledger、重跑全套、改已套用 migration 或 seed 正式庫。確有 DDL 缺失才按正確順序套用；新 migration 用最新可用序號。
- [ ] **3. 驗證：** 隔離 populated DB 先備份還原，執行候選修復再執行一次，核對 rows、FK、indexes、ledger、outbox lease/fencing/dispatch marker。測試接受後 timeout 的 job 保持 unknown，沒有二次發送。
- [ ] **4. 收尾／提交：** OPS-01/05 有完整比較報告；正式套用的命令、目標 branch、DDL 差異及回復方案可審閱。沒有正式 DB 只標 deployment blocked，繼續其餘任務。提交 fix: reconcile schema readiness。

### T03 — 分離正式、fixture 及歷史資料

**對應：** F20　**依賴：** T00；DB寫入依 T01　**類型：** P1 修復

**檔案：**
- Read: `db/migrations/0030_company_data_origin.sql`
- Modify: `src/features/annual-return/repository.ts`
- Modify: `src/features/annual-return/follow-ups.ts`
- Modify: `src/routes/clients.tsx`
- Modify: `src/routes/annual-returns.tsx`
- Create: `scripts/audit-data-origin.ts`
- Create/Test: `scripts/audit-data-origin.test.ts`

**契約／責任：** 沿用 DB 既有 data_origin enum/值，不另創競爭欄位；列表及 metrics 的 scope 明確包含 origin 選項。預設排除 fixture；歷史案件依既有 policy 顯示但不可自動外發。

- [ ] **1. 重現／鎖定驗收：** 測 fixture、historical、client 三組相同 deadline：mock transport 只有可派送的 client 記錄。偽似 seed 的公司名但 origin=client 不得自動改分類。
- [ ] **2. 實作：** 先唯讀 inventory 及來源證據。公司／案件顯示來源 badge；Admin 可明確切換包含測試資料的診斷模式。來源未知列待核對，不用名稱/UUID推定並更新。沿用各提醒渠道的 suppression，在實際 dispatch 前再次檢查。
- [ ] **3. 驗證：** 驗 OPS-04、FLOW-09；記錄 include-fixtures 模式和 production 模式的不同計數。不能為維持審計的 overdue=2 而硬塞測試資料到正式指標。
- [ ] **4. 收尾／提交：** 無正式 seed/reset、無盲目 reclassify；提供待人手確認清單與逐筆修復方案。提交 fix: expose and enforce data origin scope。

### T02 — 恢復單一 scheduler 並保留真實執行證據

**對應：** F02　**依賴：** T01 程式／schema契約；正式啟用另需 T03、T15／T17 對應pass gate　**類型：** P0 修復＋環境操作

**檔案：**
- Modify: `src/server/nitro-scheduled.ts`
- Modify: `src/server/maintenance.ts`
- Modify: `src/server/cron.ts`
- Read: `src/server.ts`
- Modify: `wrangler.template.jsonc`
- Modify/Test: `src/server/maintenance.test.ts`
- Create: `docs/audit-remediation/scheduler-runbook.md`

**契約／責任：** maintenance run 必須分 scheduled/manual，記 scheduledAt、startedAt、finishedAt、pass 結果、claimed/completed/failed/unknown 數量及 correlation ID；重用既有 run schema，只在必要時加欄位。

- [ ] **1. 重現／鎖定驗收：** 測試其中一個 pass 故障仍保存其他結果；並發 tick、worker 中止、lease 過期不雙派送；build 產物有 scheduled hook。沒有 tick、啟動失敗、記錄寫入失敗分別可診斷。
- [ ] **2. 實作：** 先確認 Vercel 網站與 Cloudflare Worker 的實際拓撲、版本、DB branch、cron trigger，不因 vercel.app 推斷 Worker 不存在。修復原定 runtime wiring；只有證據證明需要遷移時才改 scheduler，切換前停舊 trigger。維持約每5分鐘的既有設計及 waitUntil。保留現有 outbox 安全機制。
- [ ] **3. 驗證：** 本地測 maintenance；CI 驗編譯 handler。staging 在 mock/隔離 recipient 下看3次真正 scheduled tick、freshness≤10分鐘、due jobs 下降；manual run 不能算這3次。正式開啟前先盤點4筆通知與14筆分析是否仍存在、origin、recipient、idempotency/unknown。
- [ ] **4. 收尾／提交：** scheduler 有單一 owner、runbook、告警及真實 timestamp。程式合併可先完成，正式 dispatch activation 必須另外通過 gate。提交 fix: restore observable scheduled maintenance。

### T23 — Operations 顯示實際配置與健康證據

**對應：** F17　**依賴：** T01、T02程式；隨各connector更新　**類型：** P2 修復

**檔案：**
- Modify: `src/features/operations/capabilities.ts`
- Modify: `src/features/operations/health.ts`
- Modify: `src/features/operations/repository.ts`
- Modify: `src/features/operations/server-fns.ts`
- Modify: `src/routes/operations.tsx`
- Modify/Test: `src/features/operations/capabilities.test.ts`
- Modify/Test: `src/features/operations/health.test.ts`

**契約／責任：** CapabilityStatus分 implemented/configured/health(healthy|degraded|failed|unknown)/lastVerifiedAt/approvalRequired/owner/nextAction；不以單一green badge代表全部。查詢失敗回unknown而不是0。

- [ ] **1. 重現／鎖定驗收：** 有歷史tick但stale、配置存在但probe失敗、adapter implemented但沒credential、approval未完成、metrics query error；各顯示正確原因。
- [ ] **2. 實作：** 去除與實際adapter/config矛盾的固定文字，連到診斷runbook；由server安全查bindings presence及近期run evidence。不要在render上觸發外部write/test message。Admin可看敏感診斷，其餘只可看授權狀態；errors用correlation ID不露token。
- [ ] **3. 驗證：** OPS-03及MSG-01；old tick顯示stale，不說never observed；僅有實作不能標healthy；health恢復不自動取消人工approval gate。
- [ ] **4. 收尾／提交：** Operations可以回答哪一步不通、最後何時成功、由誰跟進。提交 fix: report capability health from runtime evidence。

### T04 — 統一案件 ID 與 Portal 深連結

**對應：** F03　**依賴：** T00　**類型：** P1 修復

**檔案：**
- Modify: `src/routes/portal.tsx`
- Modify: `src/routes/documents.tsx`
- Create: `src/lib/entity-id.ts`
- Create/Test: `src/lib/entity-id.test.ts`
- Modify/Test: `src/routes/-portal-reachability.test.tsx`

**契約／責任：** parseEntityId(value: unknown): string | null 接受 DB 支援的 canonical UUID，包括既有 version-0 seed ID；形狀檢查不代替 authorization。缺參數、invalid ID、無權／不存在由 route 分開處理，但不能洩漏別人案件是否存在。

- [ ] **1. 重現／鎖定驗收：** 將 40000000-0000-0000-0000-000000000002 及其他2個既有 ID 與新 UUID 加入回歸；invalid string/empty/filter change。先確認原 regex 失敗。
- [ ] **2. 實作：** 統一 Portal/Documents 的 query validation；搜尋其他 UUID regex 及 zod validators，按同一 DB 契約修正。保留 server auth；Portal 缺 caseId 時提供授權案件選擇器和返回今日工作，而非死路。保留登入 redirect。
- [ ] **3. 驗證：** 跑 entity-id 及 portal tests；Admin 從 case 開 portal、Documents 切 case、Client 跨公司 ID 被拒。fresh magic-link 回跳由 T22 staging 測，不用既有 session 代替。
- [ ] **4. 收尾／提交：** FLOW-01/02 通過，無大規模改 ID／弱化 scope。提交 fix: accept existing case IDs across portal links。

### T05 — 統一文件列表與按 ID 存取權限

**對應：** F16　**依賴：** T00；先於 bulk及文件修補　**類型：** P1 安全前置修復

**檔案：**
- Modify: `src/features/documents/authorization.ts`
- Modify: `src/features/documents/server-fns.ts`
- Modify: `src/features/documents/repository.ts`
- Modify/Test: `src/features/documents/authorization.test.ts`
- Modify/Test: `src/features/documents/server-fns.test.ts`
- Modify/Test: `src/features/documents/repository.integration.test.ts`

**契約／責任：** DocumentAccessSubject 仍由 DB 建立。列表 SQL 與 by-ID 使用同一政策：active Admin、同隊、跨隊 case owner/reviewer；Client 依 active company membership。無 team 的 actor 是否可憑 assignment 存取需在單一 policy 明定，list/by-ID 不得互相矛盾；未確認前維持現行較嚴限制。

- [ ] **1. 重現／鎖定驗收：** 建立 active/inactive Admin/Staff/Client × 同隊/跨隊assigned/無關/無team/case-less 矩陣。每格比較 list、preview/download、review、scan enqueue、mutation。
- [ ] **2. 實作：** 建立可重用 scope builder 或權限條件映射，DB端套用 actor 範圍與使用者 filter 的交集，避免先讀全表再 client filter。確保 upload intents、版本、signed URL 也校驗父案件/公司。
- [ ] **3. 驗證：** 真 Postgres 測關聯 assignment；越權 ID 必須零寫入、沒有 signed URL。停用舊 session 即時拒絕；不能用 UI 隱藏當安全驗證。
- [ ] **4. 收尾／提交：** AUTH-04/06 有正負測試，列出 no-team 最終決策。提交 fix: align document access across list and detail。

### T06 — 文件清單對賬與缺口修復工作流

**對應：** F04　**依賴：** T05；實體修補依 T01　**類型：** P1 修復

**檔案：**
- Modify: `src/features/documents/repository.ts`
- Modify: `src/features/documents/types.ts`
- Modify: `src/routes/documents.tsx`
- Modify: `src/routes/clients.$id.tsx`
- Create: `scripts/audit-document-lineage.ts`
- Create/Test: `scripts/audit-document-lineage.test.ts`
- Modify/Test: `src/features/documents/repository.integration.test.ts`

**契約／責任：** 文件摘要回傳 provenance/availability，例如 available、metadata_only、missing_object、quarantined、unscanned；沿用既有 model 可表達者。是否可讀獨立由安全授權決定，不因改 LEFT JOIN 而放行。

- [ ] **1. 重現／鎖定驗收：** fixture 包含有 metadata 無 intent、有 intent 無 object、舊版本、unsafe object、完整 clean chain；client/case/vault 清單都可解釋每份差異。
- [ ] **2. 實作：** 用唯讀 lineage inventory 查 documents→versions→upload_intents→R2 object→scan。調整列表令 legacy metadata 可見且標原因；提供補傳／人工映射既有證據的預覽，不偽造 clean、checksum、上載人或 intent。repair 操作必須版本檢查、授權、audit；不可自動補全部。
- [ ] **3. 驗證：** FLOW-03 對每個 mismatch 有解釋；metadata-only 不產生預覽 URL、不算 verified evidence。補傳新版本保留舊記錄與追溯。
- [ ] **4. 收尾／提交：** Harbour/Kowloon 的實際 DB 根因未核對前只稱候選原因；完成可見性修復與受控補件功能。提交 fix: reconcile document metadata and storage evidence。

### T07 — 修正最後一頁與篩選競態

**對應：** F07　**依賴：** T00　**類型：** P1 修復

**檔案：**
- Modify: `src/features/annual-return/components/production-command-center.tsx`
- Modify/Test: `src/features/annual-return/components/production-command-center.interaction.test.tsx`

**契約／責任：** page.nextCursor=null 表示終點；與未載入的 undefined 區分。query key 含全部 filters、sort、actor scope；filter 改變不附加舊頁。

- [ ] **1. 重現／鎖定驗收：** 將 evidence/audit-pagination.test.tsx 的真實失敗案例併入既有 interaction test，驗載第二頁後 button 消失。加201/400/401筆、重複 click、next-page error、慢回應後切 filter。
- [ ] **2. 實作：** 優先用現有 TanStack Query infinite-query；如維持手動 state，明確 terminal 狀態與 request epoch。以 ID 去重但不能靠去重掩蓋永遠載同一頁。改 filters 後重設 cursor、row selection 及合理 focus。
- [ ] **3. 驗證：** 末頁不再 request；retry 只重試該失敗頁；新 filter 只顯示新 scope 的 rows，原始 regression 從 fail 變 pass。
- [ ] **4. 收尾／提交：** FLOW-06/07 通過並保留測試。提交 fix: terminate pagination and isolate filter requests。

### T08 — 共享案件 readiness 與下一步

**對應：** F05　**依賴：** T05、T06；DB條件依 T01　**類型：** P1 業務修復

**檔案：**
- Modify: `src/features/annual-return/workflow.ts`
- Modify: `src/features/annual-return/work-views.ts`
- Modify: `src/features/annual-return/repository.ts`
- Modify: `src/features/annual-return/server-fns.ts`
- Modify: `src/features/annual-return/components/production-case-detail.tsx`
- Create: `src/features/annual-return/readiness.ts`
- Create/Test: `src/features/annual-return/readiness.test.ts`
- Modify/Test: `src/features/annual-return/work-views.test.ts`

**契約／責任：** ReadinessSnapshot 的 sourceVersion、readyToPrepare、readyForApproval、readyToTransmit、blockers[{code,stage,message,action}] 由 server 真實證據衍生；沿用 submission/manifest gates。不要直接把 completionBlockers 全搬來 pre-submit，因 filingReference/confirmation 是交件後才有。

- [ ] **1. 重現／鎖定驗收：** 測文件齊但欠款、款項有但 proof unsafe、required evidence缺版本、party applicability未知、Received待審、舊批准遇新版本、Filed/Completed、locked。每個階段驗期待 blocker；至少驗 Kowloon 不可交件。
- [ ] **2. 實作：** 將 readiness 計算集中，Today、case CTA、package/handoff 寫入用同一 domain 規則；UI 顯示具體缺款／待內審／缺文件／未批准原因與下一步。submit transaction 重新讀 current version/lock，不信 UI snapshot。區分可以準備和可以真正送出。
- [ ] **3. 驗證：** FLOW-04、DOC-03/04；測在預覽到提交間改 payment/evidence 時回409 conflict而非錯誤批准。尚未接 destination 不顯示成功送出。
- [ ] **4. 收尾／提交：** 列表與詳情及後端 gate 一致；資料 unknown 不算 ready。提交 fix: share stage-specific readiness across case flows。

### T09 — 統一 Dashboard／案件板指標與統計單位

**對應：** F06　**依賴：** T03、T08　**類型：** P1 修復

**檔案：**
- Modify: `src/features/annual-return/repository.ts`
- Modify: `src/features/dashboard/dashboard-data.ts`
- Modify: `src/routes/index.tsx`
- Modify: `src/features/annual-return/components/production-command-center.tsx`
- Create/Test: `src/features/annual-return/metrics.integration.test.ts`

**契約／責任：** 共享 CaseScope(actor,origin,filters,HK businessDate) 的 SQL aggregate；回 overdueCases、missingDocumentCount、casesWithMissingDocuments、assignedToMe 等具名欄位，避免共用模糊 missing。

- [ ] **1. 重現／鎖定驗收：** 原3案診斷 fixture 包含 Filed Victoria：相同scope overdue應2；關閉 fixture 後依真實資料重新計算，不硬設2。另測跨午夜香港日期、多份缺件同一案、不同 owner。
- [ ] **2. 實作：** 共享未完成逾期 predicate 排除 Filed/Completed；清楚標示 我的進行中 vs 全隊進行中、份 vs 案。由完整授權集合聚合，不從首5000 hydrated cases或目前頁累加。
- [ ] **3. 驗證：** FLOW-05；SQL結果對獨立fixture真值，同scope在兩頁及filters變化一致。role/origin變更不能沿用舊快取。
- [ ] **4. 收尾／提交：** 數值、範圍、單位明確且可追查。提交 fix: unify scoped operational metrics。

### T10 — 工作分派名稱、業務 blocker 與 SLA

**對應：** F14　**依賴：** T08　**類型：** P2 修復

**檔案：**
- Modify: `src/routes/work-queue.tsx`
- Modify: `src/features/work-items/repository.ts`
- Modify/Test: `src/routes/-work-queue-case-links.test.tsx`
- Create/Test: `src/features/work-items/assignment-labels.test.ts`

**契約／責任：** AssignmentOption 回 userId、displayName、teamName、active、workload；同名用team及安全短識別補充。work item SLA blocker 與 case business blocker 是兩個明示欄位。

- [ ] **1. 重現／鎖定驗收：** 測兩位 UUID 同前綴、同姓名不同team、inactive候選、欠款且無SLA breach、逾期且文件齊。
- [ ] **2. 實作：** SQL 取真實 staff/user display name；owner/reviewer dropdown 和推薦候選使用同一標示。只列可指派且active者；SLA期限與法定申報日分開顯示，blocker 可展開及連到解決位置。
- [ ] **3. 驗證：** FLOW-08，分派後刷新持久化；無權改 assignment 被 server 拒，names query 不洩漏無權員工資料。
- [ ] **4. 收尾／提交：** 不再以兩個 Staff 20000000 代表不同人；沒有業務 blocker 才顯示沒有。提交 fix: make work queue assignments actionable。

### T11 — 付款證據審核與具體退回原因

**對應：** F15　**依賴：** T05、T06、T08　**類型：** P2 功能補齊

**檔案：**
- Modify: `src/routes/payments.tsx`
- Modify: `src/features/annual-return/server-fns.ts`
- Modify: `src/features/annual-return/repository.ts`
- Modify/Test: `src/routes/-payments.interaction.test.tsx`
- Create/Test: `src/features/annual-return/payment-review.integration.test.ts`

**契約／責任：** PaymentReviewInput 含 caseId、paymentId、proofVersionId、expectedVersion、decision、reasonCode、reasonText；金額與日期核對只顯示實際已存資料，缺值標待補。Finance是UAT職責，不新增未授權 role。

- [ ] **1. 重現／鎖定驗收：** clean proof可預覽；unsafe/missing不可；部分款、重複proof、退回补傳、兩人同時審核、預覽V1後更新V2。
- [ ] **2. 實作：** 重用安全文件預覽與授權下載，加開案件連結。reject 要具體 reason；approve 不將不足金額視為全付。若現有 payment schema 不支援部分款，先加入可追溯付款明細／餘額計算的最小 migration，不能篡改原 amount 或放寬 paid gate。
- [ ] **3. 驗證：** PAY-01/02；驗交易與audit一致，payment current version才可批准；付款狀態更新讓Today readiness同步。
- [ ] **4. 收尾／提交：** 審核者能看證據、知道差異並退回，現有無資料頁也有清楚empty state。提交 feat: add evidence-led payment review。

### T12 — 完成 Admin 員工與團隊管理

**對應：** F08　**依賴：** T05；migration依 T01　**類型：** P1 新能力

**檔案：**
- Modify: `src/routes/admin.tsx`
- Modify: `src/features/auth/neon-auth-server.ts`
- Create: `src/features/admin/repository.ts`
- Create: `src/features/admin/server-fns.ts`
- Create/Test: `src/features/admin/repository.integration.test.ts`
- Create/Test: `src/features/admin/server-fns.test.ts`
- Modify/Test: `src/routes/-admin-guard.test.tsx`

**契約／責任：** listStaff(filters,cursor)；updateStaff({userId,expectedVersion,role,teamId,active})；previewReassignment。沿用 Admin/Manager/Staff/Client roles。邀請 adapter 另隔離於 provider API；lastLogin 若無可靠事件回 unknown。

- [ ] **1. 重現／鎖定驗收：** Staff/Manager不能呼叫Admin mutation；停用後舊session被拒；2個Admin同時降級/停用最終仍至少1個active Admin。以資料庫 transaction鎖住共用 invariant，不能各自count後更新。
- [ ] **2. 實作：** 列表、search、role/team/active狀態、工作量、audit；停用先顯示未交工作與轉交選項，不自動抹除history。沿用 requireActor每次查 profile。邀請必須用已核實 Neon Auth 支援的API或明確manual provisioning流程，不能自行創造Auth user ID／信任email字串綁定。
- [ ] **3. 驗證：** AUTH-01/03/05，並發last-admin integration必跑。測已驗證身份綁定及inactive session。provider invite未配則顯示blocked但既有staff維護可用；正式邀請訊息不由實施測試任意發送。
- [ ] **4. 收尾／提交：** Admin不再整頁unavailable；帳戶維護與provider邀請分別標實際能力。提交 feat: manage staff safely from admin。

### T13 — 建立可恢复批量操作及第一批分派

**對應：** F13　**依賴：** T05、T07、T10、T12；migration依 T01　**類型：** P1 新能力

**檔案：**
- Create: `src/features/bulk-operations/types.ts`
- Create: `src/features/bulk-operations/repository.ts`
- Create: `src/features/bulk-operations/server-fns.ts`
- Create: `src/features/bulk-operations/worker.ts`
- Create: `src/components/bulk-selection-toolbar.tsx`
- Create/Test: `src/features/bulk-operations/repository.integration.test.ts`
- Create/Test: `src/components/bulk-selection-toolbar.test.tsx`
- Modify: `src/features/annual-return/components/production-command-center.tsx`
- Modify: `src/routes/work-queue.tsx`

**契約／責任：** Selection={mode:explicit_ids,ids}|{mode:filtered_snapshot,snapshotId,excludedIds}；preview→server存immutable ID/version snapshot並回count/reasons→execute({previewId,idempotencyKey})→jobId；job/item狀態及cursor結果可查。不要信 client傳來的總數或scope。

- [ ] **1. 重現／鎖定驗收：** 100案90可改5locked5越權；1240符合每頁50；跨頁選取、改filter清空／重新確認、preview後權限/版本改變；worker crash after commit。成功item不可重做、越權零寫入。
- [ ] **2. 實作：** 先做owner/reviewer分派。建立小型 durable operation/job_items 表，重用lease/fencing設計但不要塞進通知outbox；每item transaction重新授權/version check、結果及audit同交易。idempotency唯一鍵綁actor+action+payload/snapshot hash，異payload同key拒。100 item為初始chunk上限，後續用測量調整。取消只取消未開始item。
- [ ] **3. 驗證：** BULK-01/02：retryFailed只重試可重試failed，conflict要重新preview，unknown先reconcile；取消不回滾成功項。切頁／刷新可恢復job progress，export結果不含越權資料。
- [ ] **4. 收尾／提交：** 工具列顯示本頁50/全部1240與排除數；部分成功有逐筆原因、重試及結果匯出。提交 feat: add resumable bulk assignment。

### T14 — 完成月表預覽、映射與逐行套用

**對應：** F09　**依賴：** T03、T12、T13；T09供統計驗證　**類型：** P1 新能力

**檔案：**
- Modify: `src/routes/imports.tsx`
- Modify: `src/features/nar-import/repository.ts`
- Modify: `src/features/nar-import/server-fns.ts`
- Modify: `src/features/nar-import/mapping.ts`
- Modify: `src/features/nar-import/normalize.ts`
- Read: `db/migrations/0025_nar_import_staging.sql`
- Create: `src/features/nar-import/apply.ts`
- Create/Test: `src/features/nar-import/apply.integration.test.ts`
- Modify/Test: `src/features/nar-import/normalize.test.ts`

**契約／責任：** previewApply(batchId,rowIds)回原值/候選值/diff/conflict/requiredInputs與revision；applySelected({previewId,idempotencyKey})回jobId。沿用batch/row applied_at、applied_case_id、apply_error，必要才增revision/journal。

- [ ] **1. 重現／鎖定驗收：** 35實際行延伸至65格式行；同invoice不同公司；Nil/credit note/空日期；supplied due date與計算日不同；sheet year衝突；無CR/BR公司；沒有fee的付款行。
- [ ] **2. 實作：** 公司以(source_system,external_client_id)映射，案件以公司+年度及現有業務唯一約束識別；外部mapping需人工確認。保留raw及parser version。缺公司必要欄位不得建立假公司；缺金額不得建立假付款或標paid。用row transaction+version compare套用、journal before/after；相同file重播不重覆，修改版只產生review diff；歷史apply無外發。
- [ ] **3. 驗證：** IMPORT-01..04，在apply中途kill後resume；2worker並發同batch、同公司年跨batch；結果selected/applied/conflict/failed/pending各自明示。rollback以補償preview，不直接delete已被後續工作引用的案件。
- [ ] **4. 收尾／提交：** staging→mapping→preview→selected apply→per-row結果閉環；未選行保持待處理不宣稱整batch成功。提交 feat: apply reviewed NAR import rows idempotently。

### T15 — 接通安全掃描及文件版本生命週期

**對應：** F10　**依賴：** T01、T05、T06；執行worker依 T02　**類型：** P1 整合／修復

**檔案：**
- Modify: `src/features/documents/server-fns.ts`
- Modify: `src/features/documents/live-scanner.ts`
- Modify: `src/features/documents/scan-worker.ts`
- Modify: `src/features/documents/versions.ts`
- Modify: `src/server/runtime-env.ts`
- Modify/Test: `src/features/documents/scan-worker.test.ts`
- Modify/Test: `src/features/documents/live-scanner.test.ts`
- Modify/Test: `src/features/documents/scanner-selection.test.ts`
- Modify/Test: `src/features/documents/versions.test.ts`

**契約／責任：** scanner adapter沿用現有介面，結果綁object checksum+documentVersionId；production配置缺失/timeout一律unknown或quarantine，不能fallback成clean。

- [ ] **1. 重現／鎖定驗收：** clean、零byte、截斷PDF、加密PDF、隔離安全惡意樣本、provider timeout/429/invalid response、重複job、V1 scan後上V2。
- [ ] **2. 實作：** 先驗現有 DOCUMENT_SCANNER_* 與runtime adapter，不重建已有HTTP connector。使用核准staging scanner與R2；upload→quarantine→scan→review一路記版本。重試backoff有上限及可追原因；download/preview gate只接受當前clean版本。
- [ ] **3. 驗證：** DOC-01/02/04；mock契約測試及staging真scanner各留證據。未有scanner credential仍完成程式及mock；真scanner驗收保持blocked，不能改Operations為healthy。
- [ ] **4. 收尾／提交：** 安全處理可觀察、無靜默放行；現有V1 approval不批准V2。提交 fix: enforce version-bound scanning in live document flow。

### T16 — 文件內容、OCR及有引用的AI建議

**對應：** F10　**依賴：** T08、T15　**類型：** P1 新能力＋整合

**檔案：**
- Modify: `src/features/documents/text-extraction.ts`
- Modify: `src/features/documents/analysis-checks.ts`
- Modify: `src/features/documents/analysis-worker.ts`
- Modify: `src/features/documents/ai-provider.ts`
- Modify: `src/features/documents/findings-review.ts`
- Modify: `src/features/annual-return/components/case-findings.tsx`
- Create: `src/features/documents/ocr-provider.ts`
- Create/Test: `src/features/documents/analysis-golden.test.ts`
- Modify/Test: `src/features/documents/analysis-worker.test.ts`

**契約／責任：** ExtractedEvidence回versionId、sha256、pages[{page,text,spans,confidence,method}]；finding含field/party/year、observed/expected、evidence spans、unknown reason。新增介面是目標契約，需對齊既有types，不另建第二套findings。

- [ ] **1. 重現／鎖定驗收：** 合成golden A完整、B缺件、C三董事不同適用性、D錯姓名/年度及文件內惡意指令、E模糊旋轉掃描；人手真值。測無文字層不能用filename推定內容；invalid citations拒收。
- [ ] **2. 實作：** clean後才extract；有text layer用unpdf，無text layer轉核准OCR或標需人工閱讀。規則檢查內容、日期、年度及多人requirements；未知適用性保持unknown。AI只提供帶可驗引用建議，人審才有業務決定；文件內容是不可信資料，不能作指令、呼叫工具或改approval。模型/提示/schema版本與成本記錄。
- [ ] **3. 驗證：** AI-01..05；mock timeout/429/invalid JSON、版本被替換、空文字、錯引用、prompt injection。staging固定golden corpus報precision/recall/unknown比例與人手評估，不虛報100%。AI無法使用時保留人工審核；安全scan不能略過。
- [ ] **4. 收尾／提交：** 結果可回到原頁/版本，失敗可恢復且舊finding不能批准新文件；provider真實驗收與程式測試分開。提交 feat: ground document analysis in versioned evidence。

### T17 — WhatsApp 配置、收件、附件與派送閉環

**對應：** F11　**依賴：** T01、T03、T05、T08、T15；真scheduler依 T02　**類型：** P1 整合／功能補齊

**檔案：**
- Modify: `src/routes/whatsapp.tsx`
- Modify: `src/routes/whatsapp.automation.tsx`
- Modify: `src/features/annual-return/follow-ups.ts`
- Modify: `src/features/annual-return/follow-up-server-fns.ts`
- Modify: `src/features/annual-return/components/production-whatsapp-automation.tsx`
- Read: `src/features/notifications/outbox.ts`
- Modify/Test: `src/features/notifications/outbox.integration.test.ts`
- Create: `src/features/whatsapp/media-download.ts`
- Create/Test: `src/features/whatsapp/media-download.test.ts`
- Create: `docs/audit-remediation/whatsapp-runbook.md`

**契約／責任：** 沿用WOZTELL adapter/webhook/outbox/receipts；media download介面回受限stream+content metadata，接現有quarantine ingestion。UI明示drafted/queued/provider_accepted/delivered/failed/unknown；provider acceptance不是delivery。

- [ ] **1. 重現／鎖定驗收：** 共用電話2公司不得auto-map；duplicate webhook不重建；provider接受後timeout不重送；附件redirect/private host/超大/錯MIME/下載中断；Received文件不列追客缺件。
- [ ] **2. 實作：** 查官方WOZTELL文件及現有adapter，核對四個bindings名稱和media endpoint，不發明API。配置guide只顯示presence；secret只存server。對inbound提供人工case mapping audit。media URL/redirect allowlist、timeout/size/content限制，所有附件經quarantine/scan/version。保留outbox lease/fencing/0034 dispatch marker與receipt去重。
- [ ] **3. 驗證：** MSG-01..05，先mock再核准測試recipient的一次preview→approval→queue→receipt。fixture/historical不得外發；unknown要provider查證／人工對賬後才可決定下一步。live沒有憑證時輸出精確blocker，不假裝已連接。
- [ ] **4. 收尾／提交：** 缺配置、缺recipient、ambiguous mapping、派送失敗皆有可操作下一步；無自動真客戶測試訊息。提交 feat: close WhatsApp receipt and attachment workflows。

### T18 — 擴充日常批量維護

**對應：** F13, F11　**依賴：** T08、T11、T13、T14、T17程式契約　**類型：** P1 新能力

**檔案：**
- Modify: `src/routes/clients.tsx`
- Modify: `src/routes/documents.tsx`
- Modify: `src/routes/payments.tsx`
- Modify: `src/features/annual-return/components/production-whatsapp-automation.tsx`
- Modify: `src/features/bulk-operations/worker.ts`
- Create/Test: `src/features/bulk-operations/actions.integration.test.ts`

**契約／責任：** 各action在同一registry聲明permission、preview、validateCurrent、apply、retryPolicy；保持domain logic於原feature。第一版 actions：客戶owner/team維護、文件分派/退回草稿、安全文件清單匯出、追件草稿、付款核對清單匯出；不預設提供一鍵全批准/全收款。

- [ ] **1. 重現／鎖定驗收：** 100案中含無聯絡人、Received待內審、fixture、已完成、跨隊、locked；batch draft只追真正缺件。更換template或資料版本後舊preview失效。
- [ ] **2. 實作：** 以T13 toolbar/job progress覆用至clients/documents/payments/automation；每項明示是否只產生draft、是否改資料。退回原因需逐筆確認；實際訊息派送仍走既有approval/outbox。大範圍team移動重新檢查owner/team一致性與可見性。
- [ ] **3. 驗證：** BULK-03及BULK-01/02跨entity變體；部分成功、結果CSV、取消、失敗retry、selection scope一致。產生草稿不計sent。
- [ ] **4. 收尾／提交：** 常用維護可批量完成且逐筆可追；未成熟的批量業務批准不偽裝成完成。提交 feat: extend bulk maintenance across daily queues。

### T19 — 交件、人工紀錄與退件工作流

**對應：** F12　**依賴：** T08、T15；connector依 T01/T02及外部協定　**類型：** P1 新能力＋整合

**檔案：**
- Modify: `src/features/annual-return/handoff.ts`
- Modify: `src/features/annual-return/handoff-destination.ts`
- Modify: `src/features/annual-return/package-manifest.ts`
- Modify: `src/features/annual-return/work-views.ts`
- Modify: `src/features/annual-return/components/production-case-detail.tsx`
- Read: `db/migrations/0032_package_handoffs_and_returns.sql`
- Modify/Test: `src/features/annual-return/handoff.test.ts`
- Modify/Test: `src/features/annual-return/handoff-destination.test.ts`
- Create/Test: `src/features/annual-return/handoff.integration.test.ts`

**契約／責任：** 沿用handoff/returns資料模型。分 prepared/exported/manual_recorded/provider_accepted/unknown 等事實層級並映射既有enum；manual記錄含operator/time/reference/evidence，不能標成系統已傳送或監管已受理。manifest hash不可變。

- [ ] **1. 重現／鎖定驗收：** 同manifest雙request只一handoff；版本變更舊approval失效；外部接受後timeout→unknown；return rejected關聯原manifest；收到unsafe附件維持quarantine。
- [ ] **2. 實作：** 先交付approved export＋人工交件紀錄＋回件登記，清楚說明證据來源；再按正式提供的目的地protocol/rights實作adapter，不臆造API。unknown先查receipt或人工對賬再retry。Today回件tab只在有實際可讀人工/外部記錄能力後啟用，空白與未配置區分。
- [ ] **3. 驗證：** HANDOFF-01/02用mock與真staging destination分開；測manual無receipt不能宣稱external acceptance，重播不重覆；回件要求補件時新版本重新review。
- [ ] **4. 收尾／提交：** 人工流程可用不等於外部connector完成。是否完成自動交件必須附真實receipt證據。提交 feat: track approved handoffs and returned evidence。

### T20 — 日常導覽、設定維護及可存取性

**對應：** F19　**依賴：** T04、T08、T10、T11、T12、T18、T19 UI契約　**類型：** P2 UX優化

**檔案：**
- Modify: `src/components/navigation.ts`
- Modify: `src/components/nav-content.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/app-mobile-nav.tsx`
- Modify: `src/routes/today.tsx`
- Modify: `src/routes/settings.tsx`
- Modify: `src/features/checklist-templates/server-fns.ts`
- Modify/Test: `src/routes/-settings.interaction.test.tsx`
- Modify/Test: `src/routes/-settings-templates.test.tsx`
- Create/Test: `src/components/navigation.test.tsx`

**契約／責任：** 導覽分今日工作、案件與客戶、文件與付款、通訊、管理5組；role-aware可見性沿用權限，不是安全邊界。保留16個既有deep links。staff初始入口Today，Client到Portal；合法returnTo優先。

- [ ] **1. 重現／鎖定驗收：** 設計journey：我今日要做甚麼→原因→證據→完成→回同filter列表。測autosave pending/saved/error/retry、template改動不默默重寫existing cases、無權nav/action。
- [ ] **2. 實作：** 繁中香港用語一致，blocked原因可展開，loading/error/empty各有狀態與下一步。設定用明確儲存或可見autosave狀態；模板version化及生效範圍預览，新案件用新版本，existing案件只經explicit migration preview。保留filter/sort/scroll，mobile操作區不遮內容。
- [ ] **3. 驗證：** UX-01於390px和桌面；鍵盤可完成核心流程、dialog focus trap/回復焦點、可讀label/live error、44px主要觸控區。記錄screenshots與實測journey，不能只跑snapshot就宣稱UX過關。
- [ ] **4. 收尾／提交：** 新員工可從一個入口完成工作，管理者能安全改設定；不做無需求的整站重設計。提交 feat: streamline daily navigation and maintenance UX。

### T21 — 規模化查詢及前端載入效能

**對應：** F18　**依賴：** T07、T08、T09；新UI穩定後量測　**類型：** P2 效能修復

**檔案：**
- Modify: `src/features/annual-return/repository.ts`
- Modify: `src/features/annual-return/server-fns.ts`
- Modify: `src/routes/today.tsx`
- Modify: `src/routes/clients.tsx`
- Modify: `src/routes/documents.tsx`
- Modify: `src/routes/payments.tsx`
- Modify: `src/features/annual-return/components/scoped-pickers.tsx`
- Modify: `src/features/documents/repository.ts`
- Create: `scripts/benchmark-audit-queries.ts`
- Create/Test: `src/features/annual-return/scale.integration.test.ts`
- Create: `docs/audit-remediation/performance.md`

**契約／責任：** listWorkView({view,scope,filters,cursor,limit})與全域authorized search使用穩定排序(date,id等) cursor；metrics独立SQLaggregate。所有list有server上限，picker可search到第5001筆；不把取前200列當所有選項。

- [ ] **1. 重現／鎖定驗收：** 隔離生成201/401/5001/10000 cases、50000 docs；測最後一頁、5001th search、SQL counts真值、cross-scope零泄漏；空/慢/error不回假0。
- [ ] **2. 實作：** 移除Today sequential listAllCases及20k silent ceiling、Dashboard5000 hydrate、Clients全表client filter、Documents無LIMIT。權限和readiness條件在DB查詢層等價執行，domain unit與SQL fixture做parity tests。只依EXPLAIN ANALYZE BUFFERS加必要index；既有child query已batch，不貼錯N+1標籤。PDF/DOCX解析與預覽延後import，檢查實際route network再優化。
- [ ] **3. 驗證：** PERF-01在相同硬體/資料/scope/冷暖狀態記p50/p95、query count、rows、payload、memory、errors。建議暫定staging p95列表/metrics≤1s、一般操作呈現≤2s；T00量完由owner確認budget，未達不得稱通過。以小並發逐步測10/25users，禁止production壓測。記real LCP/INP/CLS，不能由chunk size推斷。
- [ ] **4. 收尾／提交：** 無截斷且改善有before/after證據；performance.md包含方法和限制。提交 perf: paginate operational views and aggregate in SQL。

### T22 — 完整日常及支援流程 UAT 與 release gate

**對應：** F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11, F12, F13, F14, F15, F16, F17, F18, F19, F20　**依賴：** 所有準備發布的任務；blocked整合可明確留未發布　**類型：** 驗證／發布準備

**檔案：**
- Create: `docs/audit-remediation/uat-results.csv`
- Create: `docs/audit-remediation/release-checklist.md`
- Create: `docs/audit-remediation/rollback-runbook.md`
- Create: `e2e/audit-remediation.spec.ts`
- Modify: `.github/workflows/ci.yml`

**契約／責任：** 每UAT row沿用原ID，新增build SHA/env/data set/actor/actual/evidence/status/retest；status=pass/fail/blocked/not_run。audit的已觀察結果只作baseline，不可複製成新pass。E2E優先用已有runner；若沒有，新增最小Playwright配置、package script及必要dev依賴，避免第二套重疊runner。

- [ ] **1. 重現／鎖定驗收：** 建立真Auth測試帳戶Admin/Manager/Staff/ClientA/ClientB及業務Finance職責；隔離合成公司、聯絡人、多董事、付款、文檔版本，provider限定測試recipient。先跑失敗的既有audit情境，再跑完整journey。
- [ ] **2. 實作：** 涵蓋新公司→聯絡人→年度案件→追件draft→Portal上載→scan→review→付款→approval→handoff→return→完成；另測公司成立、公司變更/取消、recurring service/SCR、離職轉交、settings模板、imports與bulk。必要bug另開小task並回歸，不把已測列表視為完成業務流程。
- [ ] **3. 驗證：** 執行全部50UAT；fresh magic-link與Google登入另做不沿用session。跑CI全gate、真Postgres tests及npm run verify:dev-server-imports。沒有TEST_DATABASE_URL的skip不算DB通過；verify:firm dry-run不算live。真外部服務未配則相關case blocked，mock pass另記。
- [ ] **4. 收尾／提交：** 輸出按finding的完成程度、未發布功能、部署命令和rollback；僅當使用者已授權發布才執行正式變更。沒有授權也須完成code/tests/draft PR及可審閱部署包。提交 test: verify audit remediation journeys and release gates。

## 共用驗證命令與證據格式

先依最新CI安裝；以下均從repo root執行，DB環境變數由安全設定提供，不能把真憑證貼入命令、commit或報告。測試DB有明確test環境標識與allowlist防護；fixture/seed腳本拒絕production hostname/branch。

```bash
bun install --frozen-lockfile
npm run typecheck
npm run lint
npm run test -- src/features/annual-return/components/production-command-center.interaction.test.tsx
npm run test -- src/features/documents/authorization.test.ts
npm run test -- src/features/documents/repository.integration.test.ts
npm run test
npm run build
npm run verify:firm -- --dry-run
npm run verify:dev-server-imports
```

新建測試的命令同為 `npm run test -- <本任務Test檔案>`；依task先跑focused test，再跑受影響suite。每個PR跑現有CI gates；全量suite不需每改一行就重跑。integration skip必須列原因；本地沒有服務可用CI真Postgres證據補足，但不能聲稱本地已跑。

基線快照：typecheck通過；lint為0 error/1 warning；167 test files通過、8 skip；1558 tests通過、194 skip；本地skip主要因TEST_DATABASE_URL未設。另有pagination reproducer為8 pass/1 fail。這些數字不能當作最新要求或新實施結果；重跑後記當時實值。審計main CI成功也不代表尚未接通的live功能通過。

每次執行的證據檔包含日期、commit、environment、fixture版本、command、exit code、pass/fail/skip、相關F/UAT ID。截圖及logs需刪除敏感內容；失敗與blocked保留，不覆蓋成pass。E2E若新增Playwright，T22建立明確 `test:e2e:audit` script及獨立staging配置後，才引用該命令。

## Release gate、切換與回復

1. **程式可合併：** focused regression、typecheck/lint/build、CI真Postgres與必要concurrency tests通過；AGENTS與Lovable歷史保護無違反。外部服務缺少可合併未發布功能，但UI清楚標未配置並保持server gate。
2. **DB可變更：** 目標branch/版本清楚、migration與實體schema核對、populated clone演練、備份可還原、FK與row count比較。先做expand/backward-compatible migration，再部署讀新結構的程式；不可在P0事故中順便刪舊欄位。
3. **日常工作可發布：** F03/F04/F05/F06/F07/F16回歸通過；跨角色、付款／文件current-version、原生login及日常journey已測；fixture scope清楚。阻擋某選配整合可發布其他修復，report不能寫全系統已修好。
4. **Scheduler可啟用：** 唯一trigger、schema就緒、job origin與recipient盤點、unknown dispatch保留、各pass依賴已就緒、3次真tick證據。先staging，再以受控批次處理積壓；不對未知4筆通知直接按全重試。
5. **Bulk/import可啟用：** 逐筆auth/version/idempotency、partial success、kill/resume、cancel、failed-only retry及受限batch測試通過。首次實際套用小批可審閱資料，確認結果後才擴大。production資料變更要在當時授權範圍內。
6. **外部通道可啟用：** 真服務配置與合規資料處理要求已確認；使用核准測試recipient/目的地通過receipt及unknown reconciliation。不得用mock receipt替代。手工handoff與自動handoff分開發布。
7. **切換紀錄：** 記Web SHA、Worker SHA、DB migration set、能力啟用狀態與UTC時間；HK業務日期另記。deployment依現有實際runtime工具操作，不在計劃憑空指定Vercel或Cloudflare為唯一hosting。
8. **回復：** 停止新批次／外發trigger並保存job及outbox證據；可回復到與擴充schema相容的前一app/worker版本。DB優先forward repair；只在經核對的重大資料損毀方案下還原備份，不自動執行down migration。已送訊息不可撤回；unknown先對賬；已套用import用可審閱補償而非刪除。
9. **發布後觀察：** 3次tick無異常只是起始gate；再觀察一個完整工作日的queue age、dispatch unknown/failed、query errors、核心journey、bulk partial failures及效能。每個告警有owner與下一步，不把觀察期尚未完寫成通過。

## Definition of Done

- [ ] 20 findings每項有修復commit或明確已修／不適用證據；無籠統「完成全部」。
- [ ] 50原UAT每項有actual與evidence；blocked/not_run與mock-only明示。新增並發／故障／scale測試列為補充，不取代原50項。
- [ ] Admin、每日工作、支援流程及bulk有可操作介面，能力名稱與實際動作一致。
- [ ] 關鍵資料關係、授權、current-version、冪等與outbox未知狀態經真DB驗證。
- [ ] 手動run、existing session、dry-run、unit tests都沒有冒充真scheduler/fresh login/live integration驗收。
- [ ] 本次release的PR、migration、部署及rollback包已可審閱；有授權才執行正式發布，無授權則清楚列「待部署」。
- [ ] 使用者收到短報告：已修甚麼、測了甚麼、仍阻擋甚麼、下一個具體動作及證據位置。

## Finding coverage

下表的「主要任務」負責修復，「驗收」一律由T22匯總。所有項目都保留審計證據與新結果的區分。

| Finding | 問題 | 主要任務 |
|---|---|---|
| F01 | Schema ledger／實體DDL差異 | T01 |
| F02 | Scheduler freshness／積壓 | T02 |
| F03 | Portal及文件UUID驗證 | T04 |
| F04 | 文件metadata與vault不一致 | T06 |
| F05 | 可以交件readiness錯誤 | T08 |
| F06 | 跨頁指標與單位不一致 | T09 |
| F07 | 分頁終點與filter競態 | T07 |
| F08 | Admin功能缺失 | T12 |
| F09 | 月表只有staging未apply | T14 |
| F10 | scanner／內容／OCR／AI未驗證 | T15、T16 |
| F11 | WhatsApp配置／附件／派送 | T17、T18 |
| F12 | handoff及return未接通 | T19 |
| F13 | 缺乏批量日常維護 | T13、T18 |
| F14 | work queue名稱及blocker | T10 |
| F15 | 付款缺證據review | T11 |
| F16 | 文件list/by-ID scope差異 | T05 |
| F17 | Operations固定文字與實況不同 | T23 |
| F18 | 全表載入／截斷／效能 | T21 |
| F19 | 導覽、settings及mobile UX | T20 |
| F20 | fixture與正式資料混淆 | T03 |

## 原50項UAT追蹤表

本表是執行分工，不是測試結果。所有項目新一輪狀態初始為 `not_run`；T22负责彙總。FLOW-10/11/12屬原有支援流程回歸，沒有證據顯示必須重建整個模組；如測出bug才加對應小型修復任務。

| UAT | 情境 | 對應發現 | 實施／驗證任務 | 新一輪狀態 |
|---|---|---|---|---|
| AUTH-01 | 現有 Admin session | F08 | T12、T22 | not_run |
| AUTH-02 | Magic link 返回原頁 | F03 | T04、T22 | not_run |
| AUTH-03 | Google 登入與未授權帳戶 | F08 | T12、T22 | not_run |
| AUTH-04 | 跨隊指派文件 | F16 | T05、T22 | not_run |
| AUTH-05 | 離職停用 | F08 | T12、T13、T22 | not_run |
| AUTH-06 | Client 隔離 | F16 | T05、T22 | not_run |
| OPS-01 | Schema 一致 | F01 | T01、T22 | not_run |
| OPS-02 | 排程 freshness | F02 | T02、T22 | not_run |
| OPS-03 | 排程部分失敗 | F02,F17 | T02、T23、T22 | not_run |
| OPS-04 | Fixture 外發抑制 | F20 | T03、T22 | not_run |
| OPS-05 | 備份恢复與 populated migration | F01 | T01、T22 | not_run |
| FLOW-01 | 現有案件 Portal | F03 | T04、T22 | not_run |
| FLOW-02 | 文件篩選 ID 一致 | F03 | T04、T22 | not_run |
| FLOW-03 | 文件庫與客戶列表對賬 | F04 | T06、T22 | not_run |
| FLOW-04 | 交件 readiness | F05 | T08、T22 | not_run |
| FLOW-05 | 跨頁指標一致 | F06 | T09、T22 | not_run |
| FLOW-06 | 最後一頁 | F07 | T07、T22 | not_run |
| FLOW-07 | 搜尋与 filter 競態 | F07,F18 | T07、T21、T22 | not_run |
| FLOW-08 | 工作隊列識別 | F14 | T10、T22 | not_run |
| FLOW-09 | 新客戶至新案件 | F08,F20 | T03、T12、T22 | not_run |
| FLOW-10 | 公司成立完整狀態 | F13 | T22 | not_run |
| FLOW-11 | 公司變更與撤銷 | F13 | T22 | not_run |
| FLOW-12 | 經常服務與SCR | F13 | T22 | not_run |
| IMPORT-01 | 月表 staging | F09 | T14、T22 | not_run |
| IMPORT-02 | 月表特殊值 | F09 | T14、T22 | not_run |
| IMPORT-03 | 年份與 supplied due date | F09 | T14、T22 | not_run |
| IMPORT-04 | 套用與重播 | F09 | T14、T22 | not_run |
| DOC-01 | 正常安全上載 | F03,F10 | T04、T15、T16、T22 | not_run |
| DOC-02 | 惡意/空檔/損毀/加密 | F10 | T15、T16、T22 | not_run |
| DOC-03 | 已收但未審 | F05,F11 | T08、T17、T22 | not_run |
| DOC-04 | 版本競爭與舊批准 | F10 | T08、T15、T16、T22 | not_run |
| PAY-01 | 付款證據審核 | F15 | T11、T22 | not_run |
| PAY-02 | 部分款/重覆款/退回 | F15 | T11、T22 | not_run |
| MSG-01 | 配置健康 | F11 | T17、T18、T22 | not_run |
| MSG-02 | 共用電話與多案件 | F11 | T17、T18、T22 | not_run |
| MSG-03 | 附件闭環 | F11 | T17、T18、T22 | not_run |
| MSG-04 | 正常派送與receipt | F11 | T17、T18、T22 | not_run |
| MSG-05 | 未知派送與重播 | F01,F02,F11 | T01、T02、T17、T22 | not_run |
| BULK-01 | 部分成功批量分派 | F13 | T13、T18、T22 | not_run |
| BULK-02 | 全篩選與跨頁選取 | F13 | T13、T18、T22 | not_run |
| BULK-03 | 批量追件草稿 | F11,F13 | T13、T17、T18、T22 | not_run |
| HANDOFF-01 | 正常與重試交件 | F12 | T19、T22 | not_run |
| HANDOFF-02 | 外部已收但timeout | F12 | T19、T22 | not_run |
| AI-01 | 真實完整文件 | F10 | T15、T16、T22 | not_run |
| AI-02 | 缺件與多人適用性 | F10 | T15、T16、T22 | not_run |
| AI-03 | 錯年度姓名及文件內容指令 | F10 | T15、T16、T22 | not_run |
| AI-04 | 模糊無文字層文件 | F10 | T15、T16、T22 | not_run |
| AI-05 | provider故障與版本更新 | F10 | T15、T16、T22 | not_run |
| PERF-01 | 資料量與權限規模 | F18 | T21、T22 | not_run |
| UX-01 | 手機與鍵盤日常任務 | F19 | T20、T22 | not_run |

## 給執行Codex的工作節奏

第一輪完成T00並開始最早可做的修復，不要只回覆另一份plan。遇到正式DB、login或provider阻擋，寫入台賬並轉做下一個無依賴task；已授權的可逆本地工作不需反覆詢問。每個PR完成後回報結果與下一個task。長任務中保留status與checklist，重新開session時由台賬續做，不重做整份審計。

收尾報告按「程式已驗證／staging已驗證／production已驗證／仍阻擋」分層，清楚標明實際部署狀態。若最新main已改變架構或與此計劃有實質衝突，先以具體diff更新受影響task與測試，不盲目照抄舊路徑；其餘工作繼續。
