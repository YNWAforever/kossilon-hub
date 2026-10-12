# Kossilon Staff Workflow Remediation Implementation Plan

> **For agentic workers:** 使用 `superpowers:executing-plans`（如執行環境提供）逐項執行；以 `- [ ]` 更新進度。指定執行者為 **Codex GPT-6.1 Sol**。本次交付是計劃，沒有實作、部署或寫入正式資料。

**Goal:** 讓員工可靠完成「找待辦 → 分派 → 追文件 → 安全覆核 → 收款 → 準備／批准交件 → 核對回條」，並以清楚的查詢、客戶上下文及可恢復批次工作減少重複操作。

**Architecture:** 保留現有 React／TanStack Start 路由、server functions、Postgres repositories、文件版本及 durable jobs。先驗證相容的安全發布與既有修正，再補讀取權限、共用查詢條件、有界讀模型及員工工作區；沿用 snapshot、preview、idempotency、lease/fencing、audit ledger，不另建第二套工作引擎。

**Tech Stack:** TypeScript、React、TanStack Start／Router／Query、Zod、Postgres、Neon Auth、R2 文件介面、WOZTELL、現有 Vercel／排程執行介面、Vitest、Playwright。具體安裝與 runtime 版本按候選分支重新核實。

**Spec:** `Kossilon_Staff_Audit_Evidence_2026-10-11.zip` 內的 Audit MD、Findings、Implementation Tasks、User Cases、Control Inventory、Route Coverage 及 E01–E10。上傳副本名稱多了 `(1)`；本計劃已讀取該副本，其 SHA-256 為 `49aa13837926e25a5d058150c1b4b7c7b0442c326477ceb32020c1ca6445e2ee`。

**編寫日期：** 2026-10-12，Asia/Hong_Kong。證據觀察日期為 2026-10-11；本計劃沒有重新巡查 live 或刷新 PR 狀態。檔案位置另以同 SHA 本地 checkout 核對；執行時須做版本差異檢查。建議將本計劃放入 repo 的 `docs/superpowers/plans/2026-10-12-kossilon-staff-remediation.md`，驗收紀錄放入 `docs/audit-remediation/2026-10-12/`。

## Global Constraints

- 保留 F、R、UC、E ID。34 findings、14 tasks（R14–R27）、65 user cases；F07／F22 不在本包重新關閉範圍。小節 `.1/.2` 只是原任務的可 review 子批次。
- 原 live 紀錄只有 Admin 桌面 16 個入口、32 個限定操作：11 pass、18 fail、3 blocked。另 33 個完整驗收案例：9 partial、11 blocked、13 not-tested。以上是歷史證據，不是新候選的通過結果。
- 程式存在、測試通過、隔離 staging 驗收、正式發布及正式回驗分開記錄；不能以 PR merged、HTTP 200、頁面可開或綠色 CI 取代端到端證據。
- `AGENTS.md` 要求保留 Lovable 已發布 history；不 force-push、不改寫已推送 commits，不覆蓋使用者工作。
- 非 Admin 的無 team 讀取須 fail closed；沿用各業務既有授權政策。不能因新增共用 scope 而放寬 AR、文件、Client membership 或寫入規則。
- 文件 metadata 可見不等於 bytes 存在、掃描 clean 或可批准；批准必須綁 current version、hash、安全狀態及 actor。AI 不代替人手批准；付款草稿不等於已核實款項。
- 全選範圍須等於清單 predicate；固定 snapshot 不吸收之後新增紀錄。執行時再驗權限／版本；unknown 先對賬，不盲重試。現有批次草稿功能不增加自動發送。
- 正式資料的名稱／ID 不構成 fixture 證據；恢復 scheduler 前核對 origin、收件人、同意、批准及 idempotency，保留 outbound hold。
- 證據中的 `required 34 / applied 66 / missing 1 / unknown 33` 是舊 live UI 診斷。不得把 migration 編號當檔案數，或直接對分歧 DB 重播普通 `db:migrate`。先讀實體 catalog、hash、grants／triggers，再演練修復。
- 390px 手機、1366px 桌面、鍵盤、載入／空白／錯誤／權限／部分失敗都要驗；主要操作有可見焦點和名稱，狀態不只靠顏色。
- 本次寫計劃不構成正式 migration、部署、邀請、財務批准、客戶外發或正式業務資料修改的授權。未有對應授權時，先完成可 review 候選、隔離驗收及回退包；其他獨立工作繼續。

## Review Focus

1. **合法 ID 但錯 actor／撤權／無 team：** 清單、count、detail、download、export 及 snapshot 一律重新授權；R14、R18、R23 的 UC35／58／59 覆蓋。
2. **相同排序值、空期限、並發新增／更新：** cursor 使用穩定 tie-breaker，固定 snapshot 與即時清單分清；R16、R20、R21 的 UC36／37／46–48 覆蓋。
3. **預覽後版本或 owner 改變：** 舊文件與付款批准被拒；批次不改動新 scope，衝突可重預覽；R17、R18、R22 的 UC53／59／51 覆蓋。
4. **請求成功但回應遺失／斷線重送：** 不重複入賬、派送或交件；unknown 保持待核對；R18、R25、R27 的 UC43／55／95／96 覆蓋。
5. **香港跨日、服務失敗及舊綠色畫面：** 明示 HK 時區、觀察時間、失敗與重試；R24、R26 的 UC52／60–62 覆蓋。

## 1. 基準與執行前核對

| 項目 | 證據包的已知基準 | 執行前應產出的紀錄 |
|---|---|---|
| main | `da82677bdeb35b9255425be61bd66abd295f5cc1` | 目前 HEAD／main／dirty status／與此 SHA diff |
| live source | `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` | alias→deployment→artifact→source 的關係 |
| deployment | `dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`，iad1 | web 與實際 scheduler owner 的版本、region、runtime |
| PR142 | draft/open；head `9f2483dfd80433afc3df38f99014bb37746c2168`；base `codex/audit-r13-dependency-gates-20261009` | HK 時間／freshness 改動及相依 commit 是否已納入候選 |
| PR143 | draft/open；head `01b56fa2efd719209c1f9a36ee9cab6cb9b70d3e`；base main | dependency 修補與現在 CI／lock 的關係 |
| PR144 | merged 到 `codex/oct3-live-security-base`；head `d53acdf13c4915fabcf54334322d64f8a7fb473d` | maintenance base 是否仍吻合 live；不是 main 或 production 已發布的證明 |
| 本機測試 | 10 個 component 檔、68 tests passed、6.13s | 新候選自己的命令、結果、skips、環境；舊 68 tests 不重算 |
| 安全版本 | E05 記錄當時 patched floors：react-start `1.168.60`、start-server-core `1.169.39` | 執行當日重新查官方 advisory、兩份 locks 及 installed artifact；不把這兩個歷史 floor 當永遠足夠 |

執行者先讀 `AGENTS.md`、證據包報告、Tasks／UC CSV，再讀相應 E 檔及原碼。建立 `baseline.json`，只記 SHA、日期、環境身份、缺少的驗收資源，不記 secret。有新 commits 時按 finding 比較行為，已修好的部分改列「待驗收」，不要重新開發。

不要在當前工作目錄盲目 reset 或 checkout。需要隔離時建立正常分支／worktree；維持已推送歷史。現有 repo 同時維護 `bun.lock` 與 `package-lock.json`；本基準 CI 用 Bun 1.4.2 與 Node 22／24，另驗 npm 安裝。遵守執行當時的 repo CI，不只跑一種 installer。

## 2. 分批發布與依賴

| 批次 | 任務 | 可獨立交付的成果 | 必須通過的 gate |
|---|---|---|---|
| A 安全 maintenance | R25.1；R23 按此 scope 驗收 | 最小相容安全候選 | installed 依賴、runtime、DB contract、回退；不等全部 UX |
| B 核心恢復 | R25.2–3、R14、R18.1、R26 | 相容 schema／scheduler、讀 scope、範圍正確的現有 UI | 未分類 outbox 不外發；R14 與 F35 回歸後才開放對應功能 |
| C 文件與款項 | R16、R17、R27 可用的子流程 | 真正有界清單、文件／付款可處理 | current version、授權 join、真 provider 回執 |
| D 員工效率 | R15、R19、R20、R21、R18.2–3、R22；R24 可獨立 | 統一今日工作、客戶上下文、批次工作中心、可用支援流程 | 狀態返回、全部授權資料可達、交接無孤兒案 |
| E 每次候選驗收 | R23 | 精確版本的 release dossier | 選定 scope 的 UC、效能／角色／裝置／回退證據 |

依賴是具體交付物而非所有父任務都必須整體完成：R25.1 不依賴 R26；R26 的本機驗收可先做，staging／發布依賴 R25.2 的相容環境。R18.1（F35 範圍修正）只依賴原有授權，可先修；R18.2–3 才依賴 R14／R16／R17。R22 的 navigation 小修可先做，交接流程才依賴 R18 的安全結果能力。R23 是每批的出口，其他實作任務不反向依賴 R23，避免循環。

**首批立即可做：** 版本／PR／lock 比較、R14 回歸與修正、R18.1 的「2 案 vs 20 案」回歸、R26 既有修正驗收；若 staging 或 provider 缺少，繼續 R16／R17／R24 本機及隔離測試，不停在等待。

## 3. 共用實作決策

以下是新增／調整的設計契約，不是聲稱現在已有的 API。若目前 HEAD 已有等價功能，重用並記錄映射。DTO 放在無 server-only imports 的檔案，SQL 與憑證仍留在 server。

| 契約／檔案 | 定義與使用者 |
|---|---|
| 新增 `src/features/auth/team-read-scope.ts` | `TeamReadScope = { kind: "all" } \| { kind: "team"; teamId: string }`；`requireTeamReadScope(actor: AuthenticatedActor): TeamReadScope`。inactive、Client、缺 staff identity、非 Admin 無 team 均拒絕。只供註冊／變更需要的 team policy；不取代其他業務較細的 policy。 |
| 新增 `src/lib/list-page.ts` | `ListPage<T> = { items: T[]; nextCursor: string \| null; total: number; observedAt: string }`。scope/filter 先於 limit，UI 不以已載入 rows 當 total；預設／上限 50，provider 已有更小上限則保留。 |
| 新增 `src/lib/list-navigation.ts` | `safeListReturnTo(input: unknown): string`：只准同站、列明路由及各頁 validated search；預設 `/today`。沿用既有安全 redirect parser，不能只做 startsWith 檢查。 |
| 擴充各 feature 的 list inputs | q、業務 filters、sort、opaque cursor。cursor 綁排序／query fingerprint；actor 每次重新解析。不從 URL 接受任意授權 scope。篩選變更清 cursor／selection，actor 變更清 cache 與 selection。 |
| canonical predicates | 清單、count、bulk snapshot、preview 重用同一套 feature filter schema 及參數化 predicate。沒有已支援 predicate 就明示拒絕，不能忽略未知欄位擴大範圍。 |
| 工作結果 | 沿用既有 jobId、snapshot、previewId、payloadHash、version、idempotencyKey、item states。UI 顯示業務名稱、範圍、操作者、更新時間及下一步。 |

一般清單採穩定 keyset（排序欄位＋唯一 ID，null 排序明訂）。資料在翻頁期間被修改可導致即時集合變動，UI 顯示更新時間及重新整理；不可保證可變資料的多頁快照一致。需要固定集合的批次一律用持久 snapshot。靜態資料的全頁遍歷必須無漏／無重複；按版本變動測試不能偷偷跳過。

金額沿用現有精確 decimal／字串處理，不新用浮點相加。日期：日曆日期不自行套 UTC 轉換；timestamp 顯示 `Asia/Hong_Kong` 及時區。新狀態名稱先對應現有 domain enum，展示文案不得直接暴露內部碼。

## 4. 可 review 任務

### R25 — 相容安全發布、schema 及 scheduler（P0）

**對應：** F01、F02、F17、F20、F21；UC57、88–90、96。Owner：Release／DB／Security。粗估 2–4 人日調查驗證，外部等待另計。

**核對／修改檔案：** `package.json`、`package-lock.json`、`bun.lock`、`.github/workflows/ci.yml`、`vercel.json`；`scripts/audit-schema-readiness.ts`、`scripts/prepare-historical-schema-release.ts`、`scripts/rehearse-historical-schema-release.mjs`、`scripts/audit-data-origin.ts`；`src/features/operations/schema-catalog.ts`、`release-compatibility.ts`、`maintenance-job-repository.ts`；`src/server/maintenance*.ts`、`src/server/cron.ts`；`src/features/notifications/outbox.ts`、`runtime-dispatch.ts`。migration 只新增經核對的新檔；不改歷史內容／編號／hash。

**介面：** 產出 `baseline.json`、`schema-compatibility.json`、`scheduler-receipts.json`、`release-candidate.json`（建議檔名）。每項綁環境、web/scheduler SHA、schema fingerprint、觀察時間、evidence refs 及限制。

**R25.1 安全候選：**
- [ ] 比對 live base、PR143／144 的最新 head/base 和依賴差異；核對官方公告與實際 installed dependency tree。已有修補只驗收，不重做。
- [ ] 在獨立 maintenance 分支重現 lock／runtime gate，修最小相容差異；不能把整個新 schema main 當安全更新。
- [ ] 跑 dependency locks、parser、build、runtime 及 auth smoke；產出安裝回執／SBOM。維持兩個 Node CI legs，不能刪 audit 或降低門檻令 CI 變綠。
- [ ] 提交一個可 review commit／PR；附獨立回退 artifact 及相容證據。此子批次不等候員工 UX 完工。

**R25.2 資料相容：**
- [ ] 對獲授權目標執行唯讀 ledger＋實體 DDL inventory：tables、columns、indexes、constraints、functions、triggers、grants、RLS，以及 outbox dispatch marker；檢查 repo catalog 覆蓋不足的部分。
- [ ] 為每個差異分類「已存在／缺少／hash 不符／未知」及處理方式；不能造 ledger ID 或把 unknown migration 刪掉當修復。
- [ ] 在隔離 clone 演練備份還原及 reviewed reconciliation，再跑完整 runtime contract。只有乾淨 disposable test DB 可跑普通 migration／seed；正式分歧 DB 不可直接照 CI 操作。
- [ ] 跑兼容性與 rehearsal tests，提交差異報告和 forward-fix；沒有 restore 成功回執時發布列 blocked。

**R25.3 排程：**
- [ ] 確認唯一 scheduler owner、五分鐘觸發方式、service identity、web/scheduler SHA。Vercel cron 設定、Cloudflare hook 或手動 HTTP 呼叫各自不是 native tick 證據。
- [ ] 維持出站 hold；唯讀盤點原有 4 項 outbox 的 origin、收件人及未知結果。hold 若不存在，先加可驗證的 feature 級 hold，禁止以假發送器冒充成功。
- [ ] 隔離測試同 slot 重播、lease 過期接手、舊 worker fencing、worker 中途故障；同項副作用只一次。無 provider 的 pass 明示 blocked，不能整個 tick 假報完全成功。
- [ ] 同一候選在隔離 scheduler 取得至少 3 個真實五分鐘 tick（首尾至少 10 分鐘），逐 pass 記 started／finished、處理量、失敗及 provider reference；SQL-only batch 可在出站 hold 下驗。
- [ ] 通過後按既有授權提交具體 rollout；有正式授權才發布／恢复相應 pass，之後只讀回驗 freshness。未驗的 provider pass 留 blocked。

**測試命令（現有路徑）：** `npx vitest run scripts/dependency-locks.test.ts scripts/prepare-historical-schema-release.test.ts src/features/operations/release-compatibility.test.ts src/server/maintenance.test.ts src/server/maintenance-trigger.test.ts src/server/cron-wiring.test.ts`。schema／DB 測試另依第 6 節隔離環境執行。

**回退：** 優先關閉有問題的 pass／外發入口並保留 ledger；退回已驗證安全且與 DB 相容的 artifact。不可回滾至已知未修補安全版本，不盲跑 down migration，不重新派送 unknown。

### R14 — 補註冊／變更讀取權限（P1，先於擴大工作區）

**對應：** F16；UC35、58。Owner：Backend／Security；1–2 人日。依賴：無；原來源為 code-only，不能宣稱正式已發生洩漏。

**檔案：** 新增 `src/features/auth/team-read-scope.ts` 及 `.test.ts`；修改 `src/features/incorporation/{authorization,server-fns,repository}.ts`、`src/features/corporate-changes/{authorization,server-fns,repository}.ts`。新增各 feature `read-scope.integration.test.ts`。

**介面：** `requireTeamReadScope(actor)` 回傳顯式 all／team；兩個 repository 的 list／by-ID 方法增加必填 scope，不能用 `undefined` 同時代表「Admin 全部」及「非 Admin 沒有 team」。既有 AR／文件 policy 保留。

- [ ] 寫 `rejects_other_team_and_missing_team`：兩 team、active Admin／Manager／Staff、inactive、Client；斷言 list／count／by-ID 不能漏資料，非法 actor 不觸發無限制 SQL。
- [ ] 跑新 regression 並記錄修正前失敗；若最新 HEAD 已通過，記錄已有修復並做整合驗收。
- [ ] 把 actor 從 server function 傳到 scope；SQL 在 list／detail／count 內限制範圍，不先全量讀取再前端 filter。
- [ ] 以真正隔離 session 測 UC35／58：猜 ID、換 team、撤權後舊 session、download/export 等各自現有政策。錯誤不得洩露另一公司的名稱或存在與否。
- [ ] 跑 `npx vitest run src/features/auth/team-read-scope.test.ts src/features/incorporation/read-scope.integration.test.ts src/features/corporate-changes/read-scope.integration.test.ts`；檢查 integration 沒被 skip。
- [ ] 提交 `fix: enforce team scope for incorporation and corporate change reads`；更新 R14。回退只可退到同等嚴格授權版本，否則暫停入口。

### R18.1 — 先修批次範圍不一致（P1）

**對應：** F35；UC42、59。Owner：Backend／Frontend；屬 R18 的獨立第一批，不必等新工作中心。

**檔案：** `src/features/annual-return/components/production-whatsapp-automation.tsx`、`src/components/bulk-selection-toolbar.tsx`、`src/features/bulk-operations/{types,repository,server-fns}.ts`；新增 `src/features/bulk-operations/selection-scope.integration.test.ts`。

**介面：** 原資源 `annual_return_case` 維持以案為單位；新增嚴格驗證的 `selectionContext: "whatsapp_draft_cases"` 及與草稿列表相同 filters。同案多草稿只計一案，UI 明示「選取草稿所屬案件」。count／snapshot／preview 共用 `EXISTS` 草稿 predicate，空結果就是 0。

- [ ] 寫 `draft_scope_selects_two_of_twenty`：20 個有權 AR、其中 2 案在草稿清單；explicit selection 及 filtered snapshot 都只含這 2 案，另 18 案不可加入。加同案 2 草稿及非授權草稿負例。
- [ ] 以新測試重現；沿用原 snapshot schema 的 strict 驗證，未知 context／filter 明確拒絕。
- [ ] 把列表 filters 傳到 toolbar／snapshot；server 對兩種 selection 都套同一 scope；confirmation 明示案件單位及數目。若另做「全部案件建立草稿」，必須是獨立入口及預覽，這輪不順手新增。
- [ ] 測 snapshot 後新增草稿、owner 改變、撤權、相同 key 重送；不擴集合、不重複改動、權限縮減逐筆拒絕。
- [ ] 跑 `npx vitest run src/features/bulk-operations/selection-scope.integration.test.ts src/features/annual-return/components/production-whatsapp-automation.interaction.test.tsx src/components/bulk-selection-toolbar.test.tsx`，提交獨立 commit。

**驗收／回退：** 2 案必須仍是 2 案；沒有自動發送。必要時只停用該 bulk action，保留其他可驗證功能及歷史 job。

### R26 — 驗收現有修補並補真正缺口（P1）

**對應：** F03–F06、F08、F09、F13、F14、F17、F19、F23、F24、F28；UC64–67、69–78、81、84、87、91–94、97（詳細原 mapping 見 tracker）。Owner：QA／Frontend／Backend；2–3 人日起，發現新缺口另估。原狀態「待驗收」。

**檔案：** `src/lib/entity-id.ts`；`src/routes/{portal,documents,today,settings,operations,admin,imports,work-queue}.tsx`；`src/features/annual-return/{readiness,work-views,board-metrics,daily-view-state}.ts`；`src/features/work-items/assignment-labels.ts`；`src/features/admin/production-staff-admin.tsx`；`src/features/nar-import/{mapping,apply,apply-panel,repository}.ts*`。只修改當前回歸證明仍有缺口的檔案。

**介面：** 沿用 `parseEntityId`、current-version readiness、scope metrics、staff admin、NAR row journal。把 prepare／approval／transmit 狀態分開展示；不重建第二套流程。

- [ ] **R26.1 身份及文件：** canonical ID `40000000-0000-0000-0000-000000000002` 在隔離 fixture 可選、可深鏈；缺值、array、malformed、其他 actor ID fail closed，不默默退到「所有案件」。legacy metadata 仍可見且明示 unavailable 原因，unsafe／unknown 不可下載批准。
- [ ] **R26.2 readiness／數字／分派：** Case B 付款 pending 不列「可準備交件」；Filed／Completed 不計待辦 overdue；同 actor／filters 下 Dashboard、AR、Today 同口徑。分派用實名、team、負荷單位及理由，區分 SLA 與業務 blocker；保留 separation-of-duties。
- [ ] **R26.3 Admin／Settings：** 隔離 Admin 能開員工管理；最後 Admin、inactive、version conflict 保護仍有效。正式範本 usage 不讀 mock 20；無可信 total 就明示未提供，不造 0。
- [ ] **R26.4 Operations：** 重用 PR142 等價改動，測 `2026-10-11T16:05:00Z` 顯示香港 10 月 12 日 00:05、時區標籤；offline／500／重連不把旧綠色當最新。分開 configured／observed healthy／accepted／unknown。
- [ ] **R26.5 匯入：** 使用核准 500-row workbook fixture，含重複、無效日期、缺欄位、部分失敗；mapping→preview 不改業務資料，apply→中斷→resume→重送不重建公司／案／款項；保留 row journal，匯入草稿不能自行核實付款。這是 UC97，不是「開了表單」就 pass。
- [ ] 每子批次先跑對應既有 tests；已有修正且通過時只補缺失驗收與證據，確有缺口才修程式。提交各自 test／fix commits。

**測試命令：** `npx vitest run src/routes/-portal-identity.interaction.test.tsx src/routes/-documents-production-data.test.tsx src/routes/-today.interaction.test.tsx src/features/annual-return/readiness.test.ts src/features/annual-return/board-metrics.test.ts src/features/work-items/assignment-labels.test.ts src/features/admin/production-staff-admin.interaction.test.tsx src/routes/-settings-templates.test.tsx src/features/nar-import/apply.integration.test.ts`。PR142 的 candidate tests 需按實際 head 加入；UC52 用斷線及時間 fixture 另驗。

**發布依賴：** R25 相容候選；涉及 scope 的入口須 R14，WhatsApp 新 bulk 須 R18.1。回退保留資料、journal、job，不退回已知越權／錯 scope 行為。

### R16 — 真分頁、查詢與返回位置（P2）

**對應：** F27、F28；UC36、37、56、67、72、73。Owner：Backend／Frontend；2–4 人日；依賴 R14。

**檔案：** `src/features/work-items/{server-fns,repository,types}.ts`、`src/routes/work-queue.tsx`、`src/features/clients/components/production-client-register.tsx`、`src/features/annual-return/daily-view-state.ts`；新增 `src/lib/{list-page,list-navigation}.ts`、`src/features/work-items/queue-pagination.integration.test.ts`、`src/lib/list-navigation.test.ts`。

**介面：** 擴充 `listWorkQueueInputSchema`；新增 `listWorkQueuePage({ data: WorkQueuePageInput })` 回 `ListPage<WorkQueueSummary>`，DTO 在 `work-items/types.ts`，包含現有顯示所需 company／case／owner／blocker／SLA 摘要。UI 換到新函數；舊函數若仍有 caller 逐一遷移，不保留暗中全量查詢。

- [ ] 新增測試：10,000／50,000 active items 首頁最多 50，第二頁無重複；相同 deadline、null deadline、中文 q、轉義 `%/_`、不同 actor、非法 cursor；scope count 不洩露其他 team。
- [ ] SQL 先 scope＋filter＋stable order，再 `limit 51` 判下一頁；回傳最多 50，count 用同 predicate。以 join 取得當頁摘要，不 `listAllCases` hydrate 全量。
- [ ] q／filters／sort／cursor 放 validated URL；清單→detail帶安全 returnTo；Back／reload 回同查詢。以列表 anchor 記錄 scroll，若原列已不在集合，返回同查詢並提示已更新，不能顯示失效舊列。
- [ ] 拒絕外站、`//host`、不准路由及編碼繞過的 returnTo；分享 URL 給另一 actor 時重新授權，清所有 selection。沿用 `ensureActorQueryScope`。
- [ ] 跑 `npx vitest run src/features/work-items/queue-pagination.integration.test.ts src/lib/list-navigation.test.ts src/routes/-work-queue.interaction.test.tsx src/features/clients/components/production-client-register.interaction.test.tsx`，再按第 6 節量 query／bytes。
- [ ] 提交查詢及導航兩個可驗證 commits；記錄新 API 的 page size、sort/null/cursor contract。

**回退：** feature 級退回已驗證有界路徑；不重新引入全量 hydrate。查詢改動先 EXPLAIN，再決定最小 index；不一律加索引。

### R17 — 文件搜尋與付款 joined read model（P1）

**對應：** F29、F15；UC38–40、53、79。Owner：Backend／Frontend／Finance 業務驗收人；2–4 人日。依賴 R14；整合採 R16 的分頁契約。

**檔案：** `src/routes/documents.tsx`、`src/features/documents/{server-fns,repository,types}.ts`；`src/features/annual-return/components/production-payment-review.tsx`、`src/features/annual-return/server-fns.ts`；新增 `src/features/annual-return/payment-workspace.ts`、`payment-workspace-repository.ts`、`payment-workspace.integration.test.ts`；擴充 `src/features/documents/repository.integration.test.ts`。

**介面：** 文件 page input 增 q／companyId／category／review status／ownerId，與 bulk document filters 共用。`listPaymentWorkspacePage({ data: { view: "review" | "outstanding", q?, cursor?, limit? } })` 回 `ListPage<PaymentWorkspaceRow>`；row DTO 位於 `payment-workspace.ts`，含授權 case 摘要、payment 摘要、current proof（可 null）、readiness sourceVersion。欠款以案件為 row；憑證覆核以 document＋current version 為 row，不混單位。以 type discriminant 區分兩種 row。

- [ ] 重現 201 個案件、前 100 份憑證有一份屬第 201 案；斷言首頁可直接核對該案付款摘要，不要求先載入更多案件。
- [ ] 在授權 SQL 內 join case／payment／current proof，消除前端 `cases.find` 跨頁拼接；保留安全／版本條件，metadata-only 顯示原因。
- [ ] 建立「待覆核憑證」「待收款」分頁；無憑證、部分付款、逾期、已核對分清；總欠款只從已核實入賬計算，新增草稿不改餘額。
- [ ] 文件 production 分支提供全資料範圍的檔名／公司／類型／覆核／owner filters；測 1,000 文件後頁目標及同名不同公司。
- [ ] UC53：開 preview 後替換版本、scan unknown／unsafe、案被鎖、付款 version 改變；approve 必須拒絕並指向重讀，不能為 UI 方便繞過 guard。
- [ ] 跑 `npx vitest run src/features/annual-return/payment-workspace.integration.test.ts src/features/annual-return/payment-review.integration.test.ts src/features/documents/repository.integration.test.ts src/routes/-payments.interaction.test.tsx src/routes/-documents-production-data.test.tsx`；提交文件與付款獨立 commits。

**回退：** 關閉新 view 保留已核實 ledger；失敗回應不改已核對金額。新增 read model 不能自行遷移／重算歷史付款。

### R27 — 文件、WhatsApp 及交件真實整合（P1，provider 部分受阻）

**對應：** F04、F10、F11、F12、F20；UC53、55、85、86、90、95、96、98。Owner：Integration／QA／Operations；3–6 人日起，不含供應商等待。依賴 R25 的相容環境及 R26 文件／Portal 候選。

**檔案：** `src/features/documents/{storage,live-scanner,scan-worker,analysis-worker,ocr-provider,ai-provider}.ts`；`src/features/whatsapp/{config,woztell,webhook,media-intake,media-download,repository,server-fns}.ts`；`src/features/annual-return/{handoff,handoff-destination,handoff-repository,handoff-server-fns,package-manifest,package-archive}.ts`；`src/features/notifications/runtime-dispatch.ts`。有真實失敗才改 adapter。

**介面：** 保留 `DocumentStorage`、`DocumentScanner`、版本／hash 綁定、provider receipt、immutable package manifest 與 existing replay keys；native provider 證據與 simulated fixture 結果分開存放。

- [ ] **R27.1 文件：** 在核准 namespace 完成 intent→真 bytes upload→finalize→hash／version→真 scan→OCR／AI→人工覆核。加入 metadata-only、missing bytes、unsafe、unknown、timeout、換版本負例；不能人工把 scan 設成 clean 來完成測試。
- [ ] 建至少 20 份經核准 known-answer corpus，含文字 PDF、掃描、旋轉、低清、缺頁／缺欄位及互相矛盾資料；高風險個案重跑 3 次。記錄欄位正確率、unsupported claim、引用頁碼／位置、false-clear、延遲與可觀測成本。**安全驗收為零 false-clear**；抽取不足須標缺失並讓人覆核，不造資料。
- [ ] **R27.2 WhatsApp：** 驗 bindings 存在而不輸出值；只用核准 test recipient 做 inbound→matching／歧義人工映射→media quarantine→case attachment→人工確認→approved template→provider delivery receipt。拒絕壞簽章、重播、無收件人／同意、未知 delivery；測 provider timeout 後對賬不重送。未支援的收據狀態不得捏造成 delivered。
- [ ] **R27.3 交件：** 從當前安全版本組 immutable manifest＋真 bytes ZIP，核對 hash、目的地、批准及外部 reference；測合法回條、重播、錯 package／版本／目的地回條。只有 prepared 不得標 transmitted／filed。若採核准人工交件，用既有 attestation／return reconciliation 留下操作者、時間及證據。
- [ ] 跑 `npx vitest run src/features/documents/analysis-golden.test.ts src/features/documents/live-scanner.test.ts src/features/whatsapp/webhook.test.ts src/features/whatsapp/woztell.test.ts src/features/annual-return/handoff.integration.test.ts`；再做 native 同版本測試並保存去識別回執。
- [ ] provider 未提供時把該子流程標 blocked，列缺少的 capability、owner、最小 test 資料；其餘可獨立 UI／純 SQL 測試繼續。這種情況不得關閉 F10–F12。

**回退：** 停止受影響 dispatch／分析入口，保留原件、版本、manifest、attempt／receipt。unknown 全部對賬後才允許個別重試。

### R15 — 統一員工「今日工作」（P2）

**對應：** F26、F19；UC34、54、68。Owner：Product／Frontend／Backend；3–5 人日。依賴 R14、R16；沿用 R26 readiness。

**檔案：** `src/routes/today.tsx`、`src/features/annual-return/work-views.ts`、`work-view-repository.ts`；新增 `src/features/daily-work/{types,repository,server-fns}.ts`、`repository.integration.test.ts`；擴充 `src/routes/-today.interaction.test.tsx`。

**介面：** `listDailyWorkPage({ data: DailyWorkInput }): Promise<ListPage<DailyWorkRow>>`。`DailyWorkRow` 在 `daily-work/types.ts` 定義：`workKey`、`sourceType: "annual_return" | "incorporation" | "corporate_change_request"`、`sourceId`、`companyId: string | null`（未成立公司可以為 null）、`companyName`、`dueDate: string | null`、`ownerName`、`blocker`、`nextAction: { label; href; enabled; reason? }`、`updatedAt`。不把 incorporation 硬塞進只有兩類的原 WorkItemCaseType。

- [ ] 混合三業務各 2 案，測「我的／全隊」scope 及非授權 team；default 我的未完成，Manager／Admin 可切政策允許的全隊。
- [ ] 以 read-model union 或有界 query 組合取得待辦；AR 保留既有五分類，其他業務先用自己的 status／checklist／target date，不假設共用 AR readiness。讀模型不需要憑空建立 workflow 寫入紀錄。
- [ ] 首屏列公司、業務類型、限期、實名負責人、首個阻礙、下一步；主要 action 為原安全 action 的深鏈，不能增加一鍵批准捷徑。
- [ ] 未接通某來源顯示「此業務尚未納入」及入口，不顯示 0 冒充全部；部分來源失敗明示 partial，不遮蔽仍可用工作。
- [ ] 驗鍵盤／390px／1366px、返回同分類和範圍；測 q／sort／count 及跨日，跑 `npx vitest run src/features/daily-work/repository.integration.test.ts src/routes/-today.interaction.test.tsx`。
- [ ] 提交新讀模型及 UI；保留原路由。若需分階段開放，以可驗證的來源能力標示，不能宣稱全部業務已完成。

**回退：** 回到明示「只涵蓋周年申報」的已驗證入口；不刪原案件。

### R19 — 客戶工作總覽（P2）

**對應：** F31；UC45、76。Owner：Frontend／Backend；2–3 人日。依賴 R14、R17；可重用 R15 DTO，但不是必須等待新首頁。

**檔案：** `src/features/clients/components/production-client-detail.tsx`、`src/features/clients/{server-fns,repository}.ts`；新增 `src/features/clients/company-workspace.ts`、`company-workspace.integration.test.ts`。

**介面：** `getCompanyWorkspaceSummary({ data: { companyId } })` 回有權的 open-case summaries／counts；各分頁另外 bounded queries，不在 summary 一次裝載全部文件。CompanyWorkspaceTab = `overview | cases | documents | payments | activity`，放 validated URL。

- [ ] 一公司同時有 AR／已關聯註冊／變更／文件／欠款，另公司同名文件作負例；未成立且未關聯公司的 incorporation 不按名稱猜配對。
- [ ] 頁頂摘要未完成案、負責人、期限及下一步；分頁公司資料、全部案件、文件、款項、活動；activity 有類型篩選。
- [ ] 文件入口攜 company／case／document 的合法上下文，落地再驗 current version 及 scope；metadata-only 顯示可用下一步而非壞下載 link。
- [ ] UC45 開案／開文件／返回後維持 company 與 tab；撤權後 detail／深鏈拒絕，client identity 不可取得 staff-only 摘要。
- [ ] 跑 `npx vitest run src/features/clients/company-workspace.integration.test.ts src/features/clients/components/production-client-detail.interaction.test.tsx`，提交。

**回退：** 退顯示層但保留授權 deep links／不可用原因，不改公司資料。

### R20 — 註冊與變更列表（P2）

**對應：** F32；UC46、47、82、83。Owner：Frontend／Backend；2–3 人日。依賴 R14、R16。

**檔案：** `src/features/incorporation/components/production-incorporation-list.tsx`、`src/features/corporate-changes/components/production-corporate-change-list.tsx`；兩 feature 的 `server-fns.ts`、`repository.ts`、`types.ts`；新增各 feature `list-page.integration.test.ts`。

**介面：** 各自 `listIncorporationCasePage`／`listCorporateChangeRequestPage` 回 `ListPage<各自的列表摘要>`；input q／status／owner／due／sort／cursor。schema 用各自 status enum，不共用 AR status。

- [ ] 各建 300 筆、跨 3 公司／team／狀態／同名／相同期限；測後頁搜尋與 count、Completed 預設排除但可切歷史。
- [ ] 將「新增公司」picker 移到 create dialog；列表 q 必須傳 server 並實際篩選 requests，不能只改 picker。
- [ ] 以 R14 scope＋R16 keyset 實作，預設未完成，提供我的／逾期／未分派；owner／due labels 用業務語言。
- [ ] 開案／返回維持查詢；新增／取消仍通過 UC82／83；空、error、部分載入失敗各有下一步。
- [ ] 跑兩個 `list-page.integration.test.ts`，提交兩個可獨立 review 改動；保留現有 create/write guards。

**回退：** 關閉新 filters 的有問題部分，仍使用有界且同 scope 查詢，不恢復全量輸出。

### R21 — WhatsApp 完整歷史可達（P1）

**對應：** F33；UC48。Owner：Backend／Frontend；2–3 人日。依賴既有 inbox actor policy／R14 統一覆核；本機讀模型不依賴真發送接通。

**檔案：** `src/features/whatsapp/{conversations,repository,server-fns,types}.ts`、`components/production-inbox.tsx`；新增 `history-pagination.integration.test.ts`，擴充 `components/production-inbox.interaction.test.tsx`。

**介面：** 新 page endpoints `listWhatsAppConversationPage({data:{q?,cursor?,limit?}})` 與 `listWhatsAppMessagePage({data:{conversationId,cursor?,limit?}})`；回 scoped page。對話排序最近訊息＋ID；舊訊息按 timestamp＋ID cursor，UI 插入上方時保持 anchor。

- [ ] fixture 101 conversations、目標 thread 201 messages，另 team 負例；測同 timestamp、無訊息 thread、中文 q、最後一頁。
- [ ] scope-before-pagination；可找到第 101 對話及第 201 訊息，不能只搜尋當前 100／200。
- [ ] 新訊息到達不切 conversation、不搶走正在看舊訊息的 scroll；給「有新訊息」入口；無效 cursor／失敗重試保留已載入資料。
- [ ] 以真 actor 測 Client／Staff／撤權；provider 受阻時 scoped SQL 測試照做，native收件另外留在 R27。
- [ ] 跑 `npx vitest run src/features/whatsapp/history-pagination.integration.test.ts src/features/whatsapp/components/production-inbox.interaction.test.tsx src/features/whatsapp/server-fns.test.ts`，提交。

**回退：** 回到安全有界列表並明示歷史限制，不增加自由文字發送功能。

### R18.2–3 — 全篩選選取與批次工作中心（P1）

**對應：** F30、F13；UC41、43、44、55、59、94。Owner：Backend／Frontend／QA；連同 R18.1 原估 3–5 人日。依賴 R14、R16、R17；native background 驗收依賴 R25。

**檔案：** `src/components/bulk-selection-toolbar.tsx`、`src/features/bulk-operations/{types,repository,server-fns,worker}.ts`、`src/routes/documents.tsx`、`src/features/annual-return/components/production-payment-review.tsx`；新增 `src/features/bulk-operations/components/bulk-job-center.tsx`、`bulk-job-center.test.tsx`。沿用原有 list jobs／results 分頁及 worker。

**介面：** `createBulkSelectionSnapshot` 以 server matched count 回應固定 snapshot；snapshotCount 與已載入 count 分开。擴充 `listBulkJobs` filters：operation／actor／created range；history DTO 增 operation label／scope summary／last heartbeat。未知進度顯示 unknown；不把輪詢時間當 worker heartbeat。

- [ ] **R18.2 selection：** 1,000 文件只載首 100 即能全選，無須再按 9 次；非授權 row 不計／不泄露，locked row 計入排除原因；排除 2 筆後 preview 數符合固定集合。UI 分別顯示篩選總數、選取、可執行及排除數。
- [ ] 文件、付款兩種 row 單位與 action 資源明確；不支持的 action 隱藏或说明，不能把憑證數當案件數。filters／actor 變更清 selection；超過 server 既有上限明示分批，不偷偷截斷。
- [ ] **R18.3 jobs：** 一處可找回最近及進行中工作，顯示操作、範圍、操作者、開始／更新／心跳、成功／衝突／可重試／unknown；逐項連原案，支援安全結果匯出。
- [ ] 頁面可見且有進行中 job 時有限輪詢（初始建議 5s）；失敗退避，背景頁停輪詢、focus 重讀，完成後停止。job 執行由現有 scheduler 持續，手動 resume 只作明確 recovery。
- [ ] 50 項測試：47 成功、1 conflict、1 retryable、1 unknown；恢復後 47 不重做，conflict 重 preview，unknown 對賬後才決定；同 key 雙擊不多建 job。另測 1,000 項離頁、worker 中斷／lease 接手、過期 actor。
- [ ] 跑 `npx vitest run src/features/bulk-operations/repository.integration.test.ts src/features/bulk-operations/actions.integration.test.ts src/features/bulk-operations/membership.test.ts src/features/bulk-operations/components/bulk-job-center.test.tsx src/components/bulk-selection-toolbar.test.tsx`；以 UC55 保存 native tick 證據，再提交。

**回退：** 停止接受新 job，保留既有 ledger／逐項結果，讓已在安全執行中的工作按 review 後策略完成／取消；不刪 job、不把未知當失敗重跑。

### R22 — 角色入口、交接與設定可恢復（P2）

**對應：** F34、F19、F13；UC49–51、54。Owner：Frontend／Product／Admin；1–2 人日。依賴 R14；交接依賴 R18 安全結果處理。

**檔案：** `src/components/navigation.ts`、`src/routes/{imports,admin,settings}.tsx`、`src/features/admin/{production-staff-admin,repository,server-fns}.ts*`、`src/features/checklist-templates/{errors,repository,server-fns}.ts`；新增 `src/lib/staff-copy.zh-HK.ts`，沿用可用 i18n 機制。

**介面：** 保持 imports Admin-only，Manager 不展示可操作入口；直接 URL 給清楚權限及 Admin 支援下一步。使用現有 staff version／handover preview；範本以原 version conflict contract 回錯，不靜默覆寫。

- [ ] UC49 測四種實際 AuthRole：navigation 與 direct route 一致；「Finance／Reviewer／Ops」是工作身份，不額外虛構 auth role。
- [ ] UC50 有開放案件／work items 的員工交接：preview→範圍確認→逐項結果→再盤點→停用。最後 Admin 不可移除；有未解 conflict／unknown 不顯示交接全部完成；舊 session 撤權生效。
- [ ] UC51 兩人開同範本，A 保存後 B 保存得到明確 conflict，保留 B 輸入供比較／重套；新範本不追溯改現案 snapshot。
- [ ] 統一「負責人／覆核人／待核對／已入賬／已提交」，technical code 放詳細資訊；錯誤包含下一步及 support ID，沒有 raw SQL／secret。
- [ ] 鍵盤、focus、表單 labels、dialog 返回焦點、390px／1366px；主要按鈕可達，表格內可橫捲但整頁不可不必要橫捲。
- [ ] 跑 `npx vitest run src/components/navigation.test.tsx src/features/admin/production-staff-admin.interaction.test.tsx src/features/admin/repository.integration.test.ts src/features/checklist-templates/version.integration.test.ts src/routes/-settings-save.interaction.test.tsx`，提交。

**回退：** navigation／文案可 revert；授權、版本及最後 Admin 保護不可退弱，staff 停用／轉交的 audit 記錄保留。

### R24 — 登入錯誤分類及恢復（P2，可獨立）

**對應：** F36；UC60–63。Owner：Frontend／Backend／QA；1–2 人日。登入已成功；不把本機／雲端 session 差異當網站根因，不要求用戶重複登入才能寫此修正。

**檔案：** `src/features/auth/auth-context-neon.tsx`、`route-guard.ts`、`src/routes/{__root,login}.tsx`；新增 `src/features/auth/auth-result.ts`、`auth-result.test.ts`；擴充既有 auth／login tests。

**介面：** `AuthResolution = { kind: "authenticated"; session: AuthSession } | { kind: "unauthenticated" } | { kind: "forbidden" } | { kind: "transient_error"; supportId: string } | { kind: "callback_error"; reason: "expired" | "used" | "invalid" }`。`AuthSession` 沿用現有定義；分類使用可靠 error/status，無法判斷歸 transient，不假造 callback 原因。

- [ ] 故障注入 getSession 回 error／reject、actor 503、actor Forbidden、password 成功但 actor 失敗；assert loading 一定結束、未取得 verified actor 不 `ok:true`。
- [ ] `refreshSession` 回明確結果，try/catch/finally 涵蓋最外層；root 只把真的 unauthenticated 導 login，forbidden／transient 顯示對應下一步及 retry。
- [ ] 保留安全 returnTo 及 query cache 的 actor 隔離；服務暫時失敗不能保留舊 actor 的可寫 UI，不削弱 server guard，不記 token／cookie／magic link 完整 URL。
- [ ] UC60 同瀏覽器 callback→Today→reload 可達；另一瀏覽器應有獨立 session。UC61 過期／已用／無權不循環重寄；UC62 服務恢复後 retry 可完成。
- [ ] 跑 `npx vitest run src/features/auth/auth-result.test.ts src/features/auth/auth-context-neon.test.tsx src/features/auth/route-guard.test.ts src/routes/-root-error-contract.test.tsx src/routes/-login.interaction.test.tsx`，提交。

**回退：** 回退顯示／分類層且保留 server 授權；不盲改 cookie／SameSite／provider 設定。

### R23 — 每批整合驗收及正式接受（P1）

**對應：** F01、F18、F21、F23–F25；UC52、55–58，加該批所有 UC。Owner：QA／Release／DB／Security；2–4 人日驗證，不含等待。此任務每個 release scope 都執行，不是所有 UX 都做完才開始。

**檔案：** `scripts/{audit-uat-ledger,verify-audit-release,audit-performance-report,audit-staging-config}.ts` 及其 tests；`e2e/audit-remediation.spec.ts`、`e2e/performance.spec.ts`、`playwright.audit.config.ts`；新增 `docs/audit-remediation/2026-10-12/` 的 baseline／UC results／release dossier。只為實際新增 gate 修改 script，不刪既有 ledger 驗證。

**介面：** release manifest 必須綁 source SHA、build digest、installed deps、web／scheduler、DB contract、migration plan、UI capability、UC evidence、rollback artifact、outbound hold 狀態；腳本 report 的本機 PASS 不升格為 production GO。

- [ ] 明列本批包含／不包含的 F、R、UC，保留舊結果；新的 test tracker 從 pending／blocked 開始，同版逐一填 expected／actual／evidence。
- [ ] 完成 lint、typecheck、targeted regressions，候選合併時跑既有 CI 全 gate；Integration tests 必須在隔離 DB 有執行，skip 不是 pass。
- [ ] 依第 5–6 節完成角色、16 routes、核心流程、bulk failure、手機及效能；安全 maintenance 只驗自己影響範圍，記明其餘問題未關閉。
- [ ] 整理 migration／restore／rollout／rollback、監控與剩餘 blocker，形成 review-ready dossier。實際 production 動作依當時已有授權執行；無授權只交付候選 PR／證據，不宣稱發布。
- [ ] 若已授權發布，先部署核准精確 artifact，再驗 alias source／runtime／DB、核心只讀 smoke、真 native ticks；外發只在已核准 test recipient 及對應批准範圍進行。
- [ ] 僅在同版本所需驗收證據齊全後改「已驗證完成」。若無法取得 provider、跨角色、mobile 或 performance，保留獨立 blocked／not-tested；不以總通過率掩蓋 P0／P1。

**回退：** 依 R25／各 feature 的策略。trigger 為已確認越權、重複副作用、資料遺失、安全版本回退或核心無法使用；效能超出採納 gate 時停止擴大 rollout，保留診斷及有效資料。

## 5. User cases、fixtures 與員工流程驗收

原 65 項案例全部隨包保留；新執行 tracker 保留 baseline result／actual／evidence，新增 candidate／environment／actual／result 欄位。不能覆蓋原 2026-10-11 觀察來「變綠」。新補充子情境在原 UC 下記 subcase，不重用原 ID 表達不同事實。

| 場景 | 核准隔離資料／身份 | 必須得到的結果 | UC |
|---|---|---|---|
| 開工及找案 | Staff，3 業務各 2 案；Manager team view | 看見自身授權待辦、阻礙、下一步；開案／返回保持原位置 | 34、36、64–74 |
| 文件追查至覆核 | 1,000 文件、同名跨公司、真安全文件及 unsafe／unknown | 全域搜尋、current version、metadata 可追查、安全審閱 | 38、53、76–78、81、98 |
| 收款 | 201 案、憑證跨頁；無憑證、部分款、逾期 | 案與憑證可直接核對；已核實款項決定餘額，舊版本不可批准 | 39、40、53、79 |
| 批次 | 1,000 rows；2 草稿案／20 AR；50 項混合結果 | 同 predicate、固定集合、只重試可重試項、unknown 對賬 | 41–44、55、59、94 |
| 客戶交接 | 同公司多業務、待辦員工、最後 Admin | 跨頁保留客戶；交接後無孤兒，版本衝突可恢復 | 45、49–51、76、87 |
| 註冊及变更 | 各 300 筆、多狀態、不同 owner | 搜尋及 filters 真正作用於列表；原 create/cancel 不退化 | 46、47、82、83 |
| WhatsApp | 101 threads／201 messages，核准 test recipient | 舊資料可達、不串客戶；inbound/media／delivery 真回執 | 48、85、86、96 |
| 月表 | 核准 500 rows，重複／無效／中途故障 | preview不改資料，apply/resume冪等、錯行可追查 | 75、84、97 |
| 登入／權限 | Admin、Manager、Staff、Client A／B 真 session | 跨 team／客戶拒絕、撤權有效；error分類可恢復 | 35、58、60–63 |
| 交件與回條 | 安全真 bytes＋核准目的地／人工流程 | prepare／approve／transmit／receipt 各有證據，不跳步 | 65、66、95 |
| 系統及容量 | 同版 schema／scheduler；10k／50k；25並發 | HK時間、freshness、無重複副作用、可量測有界查詢 | 52、55–57、88–91 |
| UI 可用性 | 390px／1366px、鍵盤、不同角色 | 主要操作可達、焦點／標籤清楚、錯誤有下一步 | 54、92、93 |

Finance／Reviewer／Operations 在案例中是業務職責；用現有 AuthRole 與既有職能權限配置，不新增假角色。既有 staging harness 要 5 個不同身份；跨 team 若缺第二 staff identity，另外準備核准 test account，不能用 Admin 模擬 Staff 作通過證據。

每個 write case 先確認 namespace／環境及可清理對象。結束只清理該測試 namespace，保留去識別 audit／hash／provider reference。真實收件人、原件及帳密不放公開 PR 或交付 zip。

16 個 route 必須分角色覆核：`/today`、`/`、`/work-queue`、`/annual-returns`、`/clients`、`/incorporation`、`/corporate-changes`、`/imports`、`/payments`、`/documents`、`/portal`、`/whatsapp`、`/whatsapp/automation`、`/admin`、`/operations`、`/settings`。逐項功能／按鈕另按 Control Inventory 延伸：正常、空、invalid、denied、failure／retry、批次、返回；沒有執行的寫入按鈕留 not-tested。

## 6. 驗證命令、效能方法及證據

### 本機與隔離 CI

命令按本機可用 runtime 及候選 CI 調整並記錄實際版本；新 `.integration.test.ts` 須用 repo 現有方式指向 disposable Postgres。`DATABASE_URL` 與 `TEST_DATABASE_URL` 要明確為同一隔離 DB；不能借用 production URL。先核對各 script 的副作用再跑。

```bash
git status --short
git rev-parse HEAD
node --version
npm --version
bun --version
bun install --frozen-lockfile
npm run lint
npm run typecheck
npm run test
npm run verify:firm -- --dry-run
npm run verify:audit-release
npm run test:e2e:local
npm run build
npm run verify:dev-server-imports
```

在乾淨隔離 snapshot 可執行 CI 既有 `bun scripts/db-migrate.ts`／seed，再跑 integration；分歧正式 schema 必須走 R25 reviewed reconciliation。依賴 gate 保留 `bun audit --audit-level=low`、`npm audit --audit-level=low` 及 CI 的隔離 `npm ci` 驗證；不得用忽略 scripts 的安裝結果聲稱 production artifact 已完成。

現有 `verify:audit-release` 會區分 local ledger contract 與 `productionReleaseGate: NO_GO`；不要為綠燈硬改字串。為新批次增加可查核的 scope-bound receipt，不削弱原保護。

### 真 staging browser

先通過 `scripts/audit-staging-config.ts` 既有 guard：`AUDIT_STAGING_ORIGIN`、`AUDIT_STAGING_ISOLATED=true`、`AUDIT_STAGING_APPROVAL_REF`、精確 40 字元 `AUDIT_STAGING_RELEASE_SHA` 及五個不同受控身份。憑證只走既有 secret 機制，不在交付文件或命令紀錄輸出值。

再執行 `npm run test:e2e:audit`，保留 route、actor role、scope、fixture、expected／actual、SHA、時間及清理結果。原配置只匹配 `audit-remediation.spec.ts`；新增驗收放進此檔或明確更新 testMatch，避免寫了 spec 卻從未被執行。Provider mock、demo、local browser 與真 staging 分開標示。

### 效能

本包沒有正式 p50／p95、Lighthouse 或 load 證據；不承諾改善百分比。

- 環境：隔離同 region／拓撲／DB規格，10k 與 50k active work items；代表性文件、付款及公司分布；每次精確 SHA 與 indexes。
- 樣本：5 個代表 API（Today、Queue、Documents、Payments、Clients search），每 dataset 先暖機 20 次，再收至少 200 次 warm observations；冷啟動另收至少 20 次並記如何產生。以 25 並發跑獨立 load，不能打正式站。
- 報告：每 endpoint 的 n、p50／p95、max、錯誤率、response bytes、SQL count、rows returned、query plan；正常分頁與 total count 都計入。原始去識別 samples 與計算腳本要可重現。
- 建議目標沿原包：warm API p95 ≤ 800ms、cold ≤ 2s，屬待 owner 採納的 proposal。未採納仍報數據與前後同法比較，不能自行宣称符合業務 SLA。
- 無待決的硬標準：page 最多 50；無全量 cases hydration；static dataset 翻頁無漏／重複；count 同 scope；敏感資料零越權；worker 有界、可恢復、未知副作用不重播。
- UX 計時採相同角色／fixture／網絡重做「找案→處理→返回」「找文件」「建批次→找失敗」各 5 次，報中位耗時、點擊數、錯誤及需要協助次數，不用測試 runner 秒數冒充網站速度。

## 7. 狀態更新、完成條件與交接格式

每一個可 review 子批次循環：先以行為 regression 重現 → 最小修正／重用現有修正 → 針對性驗證 → commit → 更新 R／F／UC。已有已通過的來源修正不刻意寫失敗測試或改實作；驗收證據即可。UI 文案等低影響改動不用鏡像式測試，驗重要使用結果。

任務狀態使用「待開始／進行中／受阻／待驗收／已驗證完成」。另外保留 source_status、staging_status、release_status；每項結果需要 exact SHA／artifact／環境／actor role／UC／命令／actual／evidence／remaining blocker。blocked 要列 owner 與最小缺項，不能只寫「等待」。

**每批給使用者的回報：**
1. 本批修了哪些 F／R，員工現在能完成甚麼。
2. 哪些現有 PR／實作已重用，哪些是本批新增。
3. 實跑命令、通過／失敗／skip 數及真 DB／provider／browser 證據。
4. source／staging／正式部署各自狀態及版本；未測／受阻完整清單。
5. 具體下一批工作；若到發布步驟，附已完成 review 的 rollout／rollback／影響範圍與需要的授權。

**全案完成標準：** 本 scope 的 P0／P1 已按同候選驗收；65 案均有新結果或明確不可完成原因，所有原失敗 UC 有前後對照；保留原通過的安全門檻；16 routes 的角色／手機／錯誤覆蓋有分母；大資料與批次未漏權／重複副作用；真文件、訊息及交件有回執。若 provider 或正式發布仍 blocked，允許交付已完成子批次，但必須明說全案尚未完成。

粗估沿證據：R14–R24 為 21–37 人日，R25–R27 另有 7–13 人日調查／整合驗證範圍，彼此重疊且受外部等待影響，**不可直接相加作承諾工期**。第一輪先交 baseline、最小安全候選、R14、R18.1 及 R26 regression 結果，再按實際缺口重估。

## 8. Finding → 任務完整對照

此表沿用附件的 34 項 finding；新任務 tracker 亦補入與其相連的 live 窄範圍案例。這是計劃覆蓋，不是修復完成聲明。

| Finding | 優先 | 問題 | 實作／驗收任務 |
|---|---|---|---|
| F01 | P1 | 程式、部署與資料相容性須分開驗收 | R25;R23 |
| F02 | P1 | 正式排程失去 freshness | R25 |
| F03 | P1 | Portal 案件 ID／Documents 篩選失效 | R26 |
| F04 | P1 | 文件庫隱藏現有文件 | R26;R27 |
| F05 | P1 | 今日可交件狀態不可信 | R26 |
| F06 | P2 | Dashboard／年報板數字口徑不一致 | R26 |
| F08 | P1 | Admin 正式不可維護員工 | R26 |
| F09 | P1 | 月表未完成實際營運 apply 驗收 | R26 |
| F10 | P1 | 文件掃描／OCR／AI 審閱仍缺真實供應商閉環 | R27 |
| F11 | P1 | WhatsApp 未連接且不能完成跟進 | R27 |
| F12 | P1 | 交件／回條沒有真正目的地閉環 | R27 |
| F13 | P2 | 批次工作難辨認，進度依賴手動刷新 | R18;R26 |
| F14 | P2 | Work Queue 指派辨識與 blocker 不足 | R26 |
| F15 | P1 | 付款憑證與案件分開分頁，跨頁案件暫不可審核 | R17;R26 |
| F16 | P1 | 註冊／變更讀取接口未一致限制團隊 | R14 |
| F17 | P2 | Operations capability 文案混合配置與運作證據 | R25;R26 |
| F18 | P2 | 正式環境效能尚無可接受的量測 | R23 |
| F19 | P2 | 導航中文但操作仍中英及內部狀態混用 | R22;R26 |
| F20 | P1 | 資料來源分類及外發啟用風險 | R25;R27 |
| F21 | P0 | 正式部署來源鎖檔仍落在 Critical advisory 範圍 | R23;R25 |
| F23 | P2 | Operations 香港時間修正仍在候選分支 | R23;R26 |
| F24 | P2 | Operations 更新失敗及重連狀態修正未發布 | R23;R26 |
| F25 | P1 | 依賴修補已有候選，未完成正式接受 | R23 |
| F26 | P2 | 今日工作並非跨業務的完整每日清單 | R15 |
| F27 | P2 | 工作隊列顯示分段，但資料一次全部讀取 | R16 |
| F28 | P2 | 離開清單後搜尋及返回位置不一致 | R16;R26 |
| F29 | P2 | 正式文件庫沒有全域檔名及覆核狀態搜尋 | R17 |
| F30 | P2 | 跨頁全選被未知總數阻止 | R18 |
| F31 | P2 | 客戶詳情尚未形成可操作的整體案件視圖 | R19 |
| F32 | P2 | 註冊與變更列表缺少有效管理篩選 | R20 |
| F33 | P1 | WhatsApp 舊對話及訊息沒有可達分頁 | R21 |
| F34 | P2 | Manager 可見月表匯入但頁面只接受Admin | R22 |
| F35 | P1 | WhatsApp 全選範圍比畫面草稿清單更大 | R18 |
| F36 | P2 | 登入錯誤被吞掉，無法分辨未登入與服務異常 | R24 |
