# Kossilon Hub Remaining Development & Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. 如執行環境沒有此 skill，沿用本文件的逐任務測試與證據流程。以 **Codex GPT-6 Sol** 為指定實作者；此文件本身不要求啟動其他 agents。

**Goal:** 修復 K01–K24，完成月表至交件回件的營運流程，加入職員自助管理及可安全恢復的批量操作。

**Architecture:** 保留現有 TanStack Start 垂直功能模組、server-fns → actor authorization → raw SQL repository。共用 readiness、ID、metrics、durable bulk-operation 及 outbox contracts，單筆與批量共用同一業務服務。以實際 runtime 驗證 scheduler／storage／provider，先完成可運作的人手交件及回件流程，再接外部來源。

**Tech Stack:** TanStack Start/Router/Query、React 19、TypeScript、Vite、Tailwind/shadcn、Zod、Postgres.js、Neon Auth、R2；Vitest／Bun。部署平台以 T00 實際確認為準，不能從 Cloudflare 源碼假設 Vercel alias 正在執行相同 scheduled handler。

**Spec:** `inputs/Kossilon_Audit_2026-09-27_zhHK.md`、同名 HTML、`inputs/Kossilon_Audit_Evidence_2026-09-27.zip`。ZIP 內 source 只是審核快照，不是可 build checkout。

日期：2026-09-27（香港）；審核基準 `3af665418dae4afe14ce91dd194fdfecde10dda4`。本次只產出實作計劃，沒有修改 application、DB、權限、部署或發送訊息。

## Global Constraints

- 先读 current repository 的 AGENTS.md／CLAUDE.md；尊重既有改動；不 force-push 或重寫已推送歷史。使用 `codex/<feature>` 分支及 Conventional Commits。
- 不能重寫成 Next.js／Supabase，不能加另一套ORM或平行狀態存儲。沿用demo read-only／production server-backed邊界；production不得讀mock統計或mutate demo store。
- actor必須由request解析；所有server functions用Zod驗證並做server-side授權；UI hidden/disabled不是權限保護。
- migration前向設計；正式及任何非local `DATABASE_URL` 寫入按CLAUDE.md要求明確批准；只能先在disposable local DB演練。不得執行production seed/reset或刪未知migration ledger。
- 不把missing/failed query當empty，不把未配置／unknown analysis當passed，不把API request成功當job／provider／業務成功。
- 單筆與批量共用readiness／permissions／audit／revision checks。AI不能批准文件或申報；付款及提交需要實際證據。
- sender預設維持安全停用／simulated；接通provider與批准指定收件人是獨立runtime gate。寫這份計劃不構成向客戶、同事或邀請對象發訊息的授權。
- 原要求是職員人手上載到外部系統，系統從行方內部伺服器收回件；不要再把內部伺服器當交件目的地。
- 既有PR #68要先比較current main再整合，不直接merge有conflict的舊head；#69登入修復保留。審核時PR狀態不作現在狀態的假設。
- 技術IDs只放診斷；職員介面zh-HK，日期顯示Asia/Hong_Kong，timestamp存UTC，date-only不作時區時間轉換。
- Route目錄的test名以 `-` 開頭；不要手編 `routeTree.gen.ts`；保留PageHeader、server/client imports及CI規則。

## Review Focus

1. Provider已接收但DB commit失敗：T06故障注入必須阻止盲目重送，並保留unknown對帳。
2. Preview後改權限／證據／公司映射：T09、T11、T14、T18必須使舊批准失效，不讓bulk繞過版本檢查。
3. 相同月表不同年度、Nil／日期欄與已完成案件：T10/T11保留語意、禁止降級及無證據已付款。
4. Legacy UUID、Client猜測ID及相同UUID前綴的staff：T02/T05/T29分開語法、存在、授權，不能因放寬parser而放寬存取。
5. 回件無manifest hash、部分回件、重名檔案與中斷下載：T16提供具名人工匹配及安全重播，不讓空資料自動結案。

## 使用方式與交付結構

指定由Sol按依賴順序實作，預設單一agent逐任務推進。大型範圍拆成下列可獨立review的子系統工作包；不需要每完成一個任務都停下來問是否繼續。遇外部憑證／正式寫入授權等阻塞，先完成可測的本地工作與其餘不依賴任務，最後回報最小阻塞輸入。

ZIP：`00_START_HERE.md`（可貼給Sol）、`01_IMPLEMENTATION_PLAN.md`（完整計劃）、`02_CONTRACTS.md`、`03_TASKS.md`、`04_RELEASE_AND_TESTS.md`、`05_COVERAGE.csv`、`06_EXECUTION_STATUS.csv`、`inputs/`原始三份檔案、`planning-verification.json`及SHA256。

進入repository時將計劃放入 `docs/superpowers/plans/2026-09-27-kossilon-remaining-development.md`，spec依相對路徑一併保留。新增路徑均為**計劃 proposed**；已列Modify路徑來自審核時repo，T00若發現已移動，以搜尋到的canonical檔案更新plan並記錄，不能另造重複功能。

## 階段與發佈單位

| 階段 | 任務 | 結果與放行條件 |
|---|---|---|
| 0 基準 | T00 | current main／production／DB／PR差異及24項狀態 |
| 1 正確與可讀 | T01–T05 | schema兼容、文件與Portal可讀、readiness／metrics一致、cursor修復 |
| 2 可靠作業 | T06–T08 | outbox故障安全、唯一scheduler、真實健康狀態；未因此開live發送 |
| 3 月表及證據 | T09–T13 | durable bulk核心、import apply、文件安全及付款證據 |
| 4 交件回件 | T14–T16 | immutable package、人手提交證據、回件與異常閉環 |
| 5 訊息整合 | T17–T19 | provider驗收、context回覆、附件文件鏈 |
| 6 易維護 | T20–T24 | Admin、模板版本、各類bulk操作與逐項結果 |
| 7 智能與規模 | T25–T28 | AI/OCR人工覆核、zh-HK UX、效能、新服務驗收 |
| 8 Pilot／release | T29 | 權限、E2E、部署／恢復證據、staff quick start |

階段代表review及release group，不要求無關工作等待全部上階段。以每task的Dependencies為準；runtime-blocked不等於code-unimplemented。大task內每個checkbox可做一個小commit，完整task gate才建／更新其PR；避免一個跨30task巨型PR。

---

# 02 · Shared Contracts and Data Decisions

這些是建議新增／擴充的介面，不是宣稱現有code已有。優先包住現有型別與service；不要為配合名稱重寫已正確的核心。所有`ForActor`入口取得已驗證actor，browser不可提供role或tenant scope。

## C1 · Revision、ID 與 API 結果

EntityId為canonical DB UUID字串，語法8-4-4-4-12 hex（拒nil），包含現有legacy值；DB存在及權限獨立判斷。Revision使用現有row版本機制，沒有則加monotonic整數欄；不要用低精度時間當唯一CAS。新增 row 更新revision，expectedRevision不匹配為conflict，bulk逐項處理。

Query UI型別：`{state:'loading'} | {state:'error', code, requestId, retryable} | {state:'ready', data}`；ready才可判斷empty。沿用既有Forbidden/Unauthorized前綴與auth response，UI adapter轉為人可讀文案，不把raw SQL或secret送到browser。

## C2 · CaseReadinessSnapshot

`{caseId, revision, asOf, currentStatus, requiredEvidenceState, paymentEvidenceState, manifestResult, approval, submission, returnReconciliation, completionBlockers}`：snapshot由repository一次取得一致資料。Evidence/payment state為confirmed／outstanding／unknown；manifestResult直接用現有ManifestResult。approval保留manifestHash與批准人；submission及returns是具名已核實記錄或null。

`ReadinessResult={documentsComplete:boolean,paymentConfirmed:boolean,canApprovePackage:boolean,canRecordSubmission:boolean,canComplete:boolean,blockers:ReadinessBlocker[],snapshotRevision:number}`。Blocker用穩定code＋target ID＋可本地化message key：missing-evidence、unsafe-file、stale-version、review-required、payment-unconfirmed、unknown-data、manifest-changed、submission-missing、return-unresolved、case-locked。不是每個blocker阻所有動作：例如return-unresolved只阻completion；未知文件阻package。具體動作仍用現有permissions檢查。

不可把AI文字結論寫成human decision；保留現有`blocksRelease`對deterministic/provider-tier的差別。package-ready需要文件、付款、manifest與人工批准；complete再要求submission/return證據。

## C3 · 批次核心與狀態

`BulkSelection = {kind:'ids',ids:EntityId[]} | {kind:'filter',resource:'cases'|'clients'|'work-items'|'documents'|'payments'|'returns',filters:ValidatedResourceFilter,excludedIds:EntityId[]}`。

`BulkPreviewInput={action:BulkAction,selection:BulkSelection,parameters:ValidatedActionParameters}`。BulkAction最初assign／importApply，之後才註冊tag、export、reminderDrafts、classifyDocuments、assignReview、retryAnalysis、reconcilePayments、preparePackages、recordSubmissions、matchReturns、templateRollout。ValidatedResourceFilter與ValidatedActionParameters由各action的Zod schema定義，不使用任意SQL／untyped JSON執行。

`BulkPreview={id,previewHash,action,selectionCount,eligibleCount,skippedCount,conflictCount,expiresAt,itemsPreview}`，itemsPreview只為分頁摘要，完整ID/revision集合保存在DB。預覽15分鐘過期為初始工程設定，commit仍重驗權限和版本。hash包括actor scope、action、params、ID/revisions、該domain的內容snapshot，不包含secret。

`BulkOperation={id,action,state:'queued'|'running'|'completed'|'completed-with-errors'|'cancelled',counts,createdBy,createdAt}`；`BulkItemResult={itemId,resourceId,state:'pending'|'running'|'succeeded'|'skipped'|'conflict'|'forbidden'|'failed'|'needs-reconciliation'|'cancelled',reasonCode?,auditRef?,revisionBefore?,revisionAfter?}`。operation的completed僅表示所有items terminal；不表示全部成功。

Postgres constraints：operation actor+idempotencyKey唯一；同preview批准不可重複commit；item operation+resource identity唯一。單項domain另有business unique keys；僅request-level idempotency不足。item lease token保護狀態寫回，但外部send的attempt語意依C4，不能將逾時job一律重送。

## C4 · 傳送契約

Logical delivery持久化idempotency key、company、case、contact、purpose、cadence slot、approved preview hash。Attempt狀態至少claimed、send-started、accepted、definitely-rejected、unknown。`ProviderOutcome`是discriminated union：accepted含真实providerMessageId；definitelyRejected含經provider contract支持的non-acceptance code；unknown含errorCode及attemptRef。HTTP timeout／未知5xx不構成「確定未受理」。

commit send-started前可安全reclaim；之後若無可靠provider確認一律needs-reconciliation，不能按15分鐘visibility timeout當新send。人工重送須先顯示重複風險及原attempt資料，留下決策；系統不保證不具provider支援的exactly-once。fixture-origin、unknown-origin、失效contact、已完成案、未批准preview均不可開始provider call。

## C5 · 匯入欄位與批准政策

| 月表欄 | 自動處理 | 必須停下覆核的情況 |
|---|---|---|
| Client ID | 查source namespace + external ID mapping | 未對應、mapping跨公司或權限之外 |
| Company name | 作顯示／候選查找，不作唯一鍵 | 不能只憑近似名字新建／改名 |
| Incorp day/month | 保留normalized值及raw cell | 缺年份不能發明完整incorporationDate |
| Return year | preview語意的一部分，case(company,year)唯一 | 改年需新preview／approval，不能復用舊批次 |
| AR due | normalized date及來源，核對計算basis | 既有人工值不同、日期不合理／格式不明 |
| BR due | 對應BR服務／提醒草稿或observation | 不能寫到AR due；無canonical field時保留observation |
| Invoice | 同company/source下有效reference observation | Nil／空白不清除已有invoice；重複reference待核對 |
| Payment received date | 待核對付款observation | 不因Excel日期就Payment received；需證據及人工核對 |

新增公司條件：已核實唯一CR及現有schema必填欄、選定team/owner、明確create decision；原月表缺欄則保持unresolved，提供人工補齊表單。既有Filed／Completed案件不被import降級；import不改file verification/human approvals、不發訊息。每列audit記before/after、raw source row、preview revision、actor及結果。

## C6 · Migration 責任與兼容

可能新增群組：delivery attempts、bulk jobs/items、import preview/apply provenance、payment observations/allocations、package approvals/submission evidence、return intake provenance、staff provisioning、template version references、AI context evidence。全部先檢查現有0022–0033與current main等價schema，優先擴充而非複製table。每task PR列實際next migration filename、constraints/indexes、backfill與前後schema diff。unknown ledger差異必須證據解釋，不用DELETE/UPDATE ledger消掉紅字。

新增revision與origin欄可先nullable/backfill/validate，最後加constraint；不把所有舊公司默認改client。fixture provenance從可靠seed來源／業務確認辨認；未知狀態不允許外發。大表索引需測lock／transaction限制；不能在未證實的provider環境套固定DDL策略。

## C7 · 權限與狀態可見性

保留既有policy作最小權限基準：Admin業務scope可管理；Manager受team政策；Staff依assigned/reviewer；Client只可見membership的公司，不能讀internal notes、staff lists、bulk管理或internal provider diagnostics。若當前政策不同，T00逐項紀錄並保留更嚴限制，需產品決策才可擴權。所有export、signed download、bulk preview及job polling同樣server授權；不能只保護mutation。

## C8 · 可觀察性

每個job／batch／send包含correlation ID、actor或system trigger、case/company IDs、attempt、開始／結束及redacted error code。secret、完整文件文字、登入token、private signed URL及訊息敏感內容不寫通用logs。Operations顯示count、oldest age、last scheduled success、unknown deliveries、dead letter數、schema capabilities及責任角色；非技術staff看到自己的下一步，Admin才看整體診斷。

---

# 03 · Dependency-Ordered Task Pack

每個Test路徑是計劃新增或補強的測試；相同目的既有test可就地擴充並記錄實際路徑。Files中目录表示要先找canonical模組，新增migration編號由T00分配。每個Task是review單位；不是要求把整個Task一次提交。

## T00 · Phase 0 · 固定實作基準及確認變更邊界

**Dependencies:** None
**Audit coverage:** K01, K04, K21

**Files — Modify / inspect:**
- `AGENTS.md`
- `CLAUDE.md`
- `package.json`
- `.github/workflows/ci.yml`

**Files — Proposed create:**
- `docs/runbooks/audit-2026-09-27-baseline.md`

**Interfaces:** BaselineRecord = {auditSha,currentSha,productionSha?,migrationLedgerStatus,providerMode,openPRs,findingsDisposition}。

**Decisions:** 完整讀取三份 inputs；驗證 evidence SHA256；fetch current main／PR #68／#69，只讀差異，不將舊 ZIP 當 checkout。記錄 git status 並保留其他人的改動；建立 codex/kossilon-<task> 分支；已推送歷史不 rebase／force-push。對每個 K01–K24 記錄仍存在／已修復含證據／需重現。比較 production alias SHA、實際 scheduler、DB branch／region；敏感連線值不輸出。

- [ ] git diff 基準可查；24 個 finding 均有 disposition；unknown production SHA 不被填成 main。
- [ ] 參照當前 CI 重跑 baseline；integration skipped 必須列出，不能當通過。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 基準與依賴矩陣建立。無 production access 時完成本地可做項目，將 runtime 驗證列 blocked，不中止全部開發。

## T01 · Phase 1 · Schema 修復、資料兼容及 release gate

**Dependencies:** T00
**Audit coverage:** K01, K02

**Files — Modify / inspect:**
- `src/features/operations/schema-health.ts`
- `src/features/operations/server-fns.ts`
- `db/migrations/`
- `.github/workflows/ci.yml`

**Files — Proposed create:**
- `scripts/inspect-schema-compatibility.ts`
- `docs/runbooks/schema-reconciliation-2026-09-27.md`

**Interfaces:** inspectSchemaCompatibility(input: {expected: readonly string[]; ledger: readonly string[]; catalog: SchemaCatalog}): SchemaCompatibilityReport；report 含 missing、unknown、definitionMismatch、requiredCapabilities。SchemaCatalog 只收 table／column／index／constraint 定義，不收業務列。

**Decisions:** 先 inspect ledger 與 pg_catalog，查明 1 個未知 migration 的來源及重命名／重疊 DDL，不能假設缺 13 就補跑 13。在 disposable local DB 演練從實際舊結構升級；保留前向、可重播 backfill。Migration 只在 T00 對 current main 確認後分配下一編號，登記於 baseline，不固定從 0034 開始。release gate 按實際 schema capabilities 拒絕不兼容版本，保留健康頁讀取。

- [ ] 在 `scripts/inspect-schema-compatibility.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t01_scenario_1`：unknown migration 不被自動刪除／改名／忽略；缺 ledger 不能當空 DB。
  - `t01_scenario_2`：升級舊結構保留既有案件、文件 FK、audit；空庫完整 migrate 亦成功。
  - `t01_scenario_3`：驗證 Documents／Payments／parties／analysis／maintenance 所需結構與索引；重复執行 backfill 不新增重複資料。
- [ ] 執行 `npm run test -- scripts/inspect-schema-compatibility.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 產出精確 SQL diff、預估鎖表／時間、備份／回復及驗收清單。任何非本機 DATABASE_URL 寫入需依 CLAUDE.md 取得明確授權後才執行。

## T02 · Phase 1 · 統一 ID 與查詢失敗狀態

**Dependencies:** T00
**Audit coverage:** K02, K06, K10

**Files — Modify / inspect:**
- `src/routes/portal.tsx`
- `src/routes/documents.tsx`
- `src/routes/imports.tsx`
- `src/features/annual-return/components/production-case-detail.tsx`
- `src/features/annual-return/components/case-parties.tsx`

**Files — Proposed create:**
- `src/features/runtime/entity-id.ts`

**Interfaces:** entityIdSchema: ZodType<string>；UUID-shaped DB IDs 接受 8-4-4-4-12 十六進位並 lowercase，明確拒絕 all-zero、非字串與超長值；存在與存取權另由 server 檢查。

**Decisions:** 保留現有 legacy PK／FK，不為了 UI 驗證重寫 ID。Client ID parsing 與 server validation 使用同一契約；productionReady 不再拒絕已存在 seed IDs。每個 query 明確 pending／error／empty／data；有 caseId 但不合法顯示無效連結；沒 caseId 才顯示案件選擇器。error 可 retry，帶不洩漏敏感資料的 requestId。

- [ ] 在 `src/features/runtime/entity-id.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t02_scenario_1`：40000000-0000-0000-0000-000000000002、標準 v4／v7 可解析；malformed／all-zero 被拒。
  - `t02_scenario_2`：案件 Open portal 直達該案；Client 猜測其他公司 ID 仍被 server 拒絕。
  - `t02_scenario_3`：imports batch／company／review 及 parties 調用失敗不顯示沒有資料或 0/0 成功。
- [ ] 執行 `npm run test -- src/features/runtime/entity-id.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 另外在 src/routes/-portal.audit-regression.test.tsx 及 -imports.audit-regression.test.tsx 寫互動回歸；待 T01 後證明 live read 恢復，不能只靠 regex 測試結案。

## T03 · Phase 1 · 共用 readiness 與營運統計定義

**Dependencies:** T01, T02
**Audit coverage:** K05, K14

**Files — Modify / inspect:**
- `src/features/annual-return/work-views.ts`
- `src/features/annual-return/workflow.ts`
- `src/features/annual-return/package-manifest.ts`
- `src/features/annual-return/repository.ts`
- `src/features/annual-return/components/production-case-detail.tsx`
- `src/routes/index.tsx`

**Files — Proposed create:**
- `src/features/annual-return/readiness.ts`
- `src/features/annual-return/operational-metrics.ts`

**Interfaces:** evaluateCaseReadiness(snapshot: CaseReadinessSnapshot): ReadinessResult；OperationalMetrics = {activeCases,overdueCases,missingEvidenceCases,missingEvidenceItems,paymentPendingCases,assignedToMe,scopeLabel,asOf}。详見 02_CONTRACTS。

**Decisions:** readiness 消費現有 buildPackageManifest／blocksRelease／completionBlockers，避免另抄一套檢查。分 documentsComplete、paymentConfirmed、canApprovePackage、canRecordSubmission、canComplete。unknown 必須 block。operational active 排除 Filed／Completed；已 Filed 顯示已申報，不顯示仍待申報逾期。scope 与 filtered result 各自清楚標示；SQL aggregate 與 domain golden fixtures 相符。

- [ ] 在 `src/features/annual-return/readiness.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t03_scenario_1`：文件5/5但 payment pending：documentsComplete=true、canRecordSubmission=false、不出現在可以交件。
  - `t03_scenario_2`：付款已記錄但證據無法讀取、文件 superseded、requirements 為 unknown 均不可交件。
  - `t03_scenario_3`：同範圍 dashboard／board overdue 相同；缺件案例数与證據项数分開；pending query 不顯示0。
- [ ] 執行 `npm run test -- src/features/annual-return/readiness.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** mutations 在 transaction 中重新載入版本及 re-evaluate，不能信任 browser 傳來 ready=true。

## T04 · Phase 1 · 修復分頁及搜尋狀態

**Dependencies:** T02
**Audit coverage:** K16, K23

**Files — Modify / inspect:**
- `src/features/annual-return/components/production-command-center.tsx`
- `src/features/annual-return/query-keys.ts`
- `src/features/annual-return/board-filters.ts`

**Files — Proposed create:**
- 不新增平行模組；優先就地修復。

**Interfaces:** CasePage<T> = {items:T[];nextCursor:string|null}；若沿用現有 cases 欄位，adapter 僅在 UI 邊界轉換；getNextPageParam 只把 server null 當結束。

**Decisions:** 用既有 TanStack Query infinite query 或等價明確終止狀態；不可 null coalesce 回首頁 cursor。按 ID 去重只作保護，不掩蓋 server 錯誤。filters 變更重置 page cursor／selection；scope totals 的 key 排除 q／cursor；搜尋 debounce 300ms。

- [ ] 在 `src/features/annual-return/components/production-command-center.pagination.test.tsx` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t04_scenario_1`：401筆、pageSize=200：200+200+1，每筆一次，尾頁按鈕消失。
  - `t04_scenario_2`：risk post-filter 得空頁但仍有 nextCursor 時繼續；cursor 原樣沿用 SQL 排序。
  - `t04_scenario_3`：快速變更 q／owner、重複 Load more、請求亂序，不把舊 filter 結果 append 新清單。
- [ ] 執行 `npm run test -- src/features/annual-return/components/production-command-center.pagination.test.tsx`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 200/400整頁邊界亦需驗證；最終無重复ID、失敗可重試且原頁不丟失。

## T05 · Phase 1 · 工作隊列姓名、SLA 與逾期說明

**Dependencies:** T01, T02
**Audit coverage:** K12, K13, K24

**Files — Modify / inspect:**
- `src/routes/work-queue.tsx`
- `src/features/work-items/repository.ts`
- `src/features/work-items/sla.ts`
- `src/features/work-items/server-fns.ts`

**Files — Proposed create:**
- 不新增平行模組；優先就地修復。

**Interfaces:** WorkQueuePerson = {id,name,role,teamName,active}；SlaDisplay = {state:"not-configured"|"not-started"|"on-track"|"at-risk"|"breached"|"acknowledged"|"unavailable";workDueAt; slaDueAt; evaluatedAt}。

**Decisions:** owner／assignment suggestion 由授權 staff projection 提供名稱；同名加團隊，截斷 UUID 僅診斷。保留原 policy／business calendar，不以 work due 一律覆寫 SLA。過期工作與 SLA breach 分開呈現；缺 policy 可分派設定工作。backfill 提供 preview 並只處理符合已選 policy 的項目。

- [ ] 在 `src/features/work-items/sla.audit-regression.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t05_scenario_1`：兩個相同前綴 UUID 顯示不同名字；同名仍可區分；inactive 不可新派。
  - `t05_scenario_2`：過 workDue 但無 policy：顯示工作逾期＋SLA未設定；有policy且過due才breached。
  - `t05_scenario_3`：香港跨日／假期／acknowledged fixture 正確；scheduler 未執行顯示資料時間。
- [ ] 執行 `npm run test -- src/features/work-items/sla.audit-regression.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 新增 src/routes/-work-queue.audit-regression.test.tsx 驗證桌面及行動版分派標籤。

## T06 · Phase 2 · Outbox 傳送 attempt 與不確定結果

**Dependencies:** T01
**Audit coverage:** K04

**Files — Modify / inspect:**
- `src/features/notifications/dispatcher.ts`
- `src/features/notifications/outbox.ts`
- `src/features/notifications/types.ts`
- `src/features/notifications/runtime-dispatch.ts`

**Files — Proposed create:**
- `src/features/notifications/delivery-attempts.ts`

**Interfaces:** claimDeliveryAttempt(now,limit): ClaimedAttempt[]；beginProviderCall(attemptId,leaseToken): Promise<BeginResult>；recordProviderOutcome(attemptId,outcome: ProviderOutcome): Promise<void>；ProviderOutcome=accepted|definitelyRejected|unknown。

**Decisions:** 先比較 PR #68 與 current main，採用其有效修復且保留後續更改。claim 原子排除 fixture 與禁止傳送對象；origin 不可透過加contact變 client。commit durable send_started intent 後才呼叫 provider。過期 claimed 未開始可回收；send_started／timeout／provider成功但DB失敗一律 needs_reconciliation，不得普通 reclaim 重送。provider 支援 idempotency 才傳 stable delivery key；不宣稱跨外部系統 exactly-once。

- [ ] 在 `src/features/notifications/delivery-attempts.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t06_scenario_1`：provider accepted 後 DB 故障再 tick：不第二次呼叫 transport。
  - `t06_scenario_2`：crash before begin：可安全重取；crash after begin但call前：可能漏送但必須保留unknown供對帳。
  - `t06_scenario_3`：fixture 在cancel後enqueue、並行claim、stale lease、origin查詢失敗：都不漏過 gate。
  - `t06_scenario_4`：timeout 不當 definitelyRejected；receipt replay只記一次；已明確未受理的retry保留同logical delivery identity。
- [ ] 執行 `npm run test -- src/features/notifications/delivery-attempts.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** SQL integration 測試覆蓋併發與重取；unknown 無法由供應商確認時保留人工處理，不假造sent。

## T07 · Phase 2 · 實際 runtime 排程及作業 ownership

**Dependencies:** T01, T06
**Audit coverage:** K21, K13

**Files — Modify / inspect:**
- `src/server.ts`
- `src/server/nitro-scheduled.ts`
- `src/server/cron.ts`
- `src/features/operations/repository.ts`
- `.github/workflows/ci.yml`

**Files — Proposed create:**
- `src/server/maintenance-trigger.ts`
- `docs/runbooks/maintenance-runtime.md`

**Interfaces:** runMaintenanceTick(input:{trigger:"scheduled"|"manual";scheduledAt:string;runId:string;allowedJobs:MaintenanceJobKind[]}): Promise<MaintenanceRunResult>。

**Decisions:** T00 確認實際 scheduler：若既有 Cloudflare Worker 確實運行，保留唯一 owner；若只有 Vercel production，實作其可支援的 server cron adapter／配置並由當前官方文件確認限制，不把 cloudflare hook 當 Vercel cron。HTTP trigger 若採用需伺服器秘密驗證、拒絕普通 session／unsigned request。所有 provider calls／長jobs用 bounded batches；按job lease，單job失敗不偽造整run success。初次排程只開非傳送 job，send 另受 T06／T17 gate。

- [ ] 在 `src/server/maintenance-trigger.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t07_scenario_1`：同scheduledAt雙觸發只執行一次；lease過期可恢復未開始job。
  - `t07_scenario_2`：未授權trigger拒絕；secret不入log；manual不計scheduled success。
  - `t07_scenario_3`：故意使一job失敗，其他job狀態獨立，排程下一tick恢复。
- [ ] 執行 `npm run test -- src/server/maintenance-trigger.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 實際目標環境連續3個scheduled run成功並記錄時間、SHA及job結果；未知外部Worker不得與新scheduler同時消費同隊列。

## T08 · Phase 2 · 動態 capabilities 與支援診斷

**Dependencies:** T01, T07
**Audit coverage:** K20, K03

**Files — Modify / inspect:**
- `src/features/operations/capabilities.ts`
- `src/features/operations/server-fns.ts`
- `src/features/operations/health.ts`
- `src/routes/operations.tsx`

**Files — Proposed create:**
- `src/features/operations/capability-status.ts`

**Interfaces:** CapabilityStatus = {id,implemented,configured,reachable:"unknown"|"yes"|"no",lastSuccessAt:string|null,evidenceRef:string|null,state:"unconfigured"|"unverified"|"healthy"|"degraded"|"blocked",checkedAt}。

**Decisions:** 以部署binding presence、實際job結果與獨立受控probe產生狀態。保留 offline verifier 無網絡／只列binding名稱的原契約；網絡probe另放runtime health service。UI只公開最小資訊；blocked 每項有影響、責任角色、下一步。缺schema顯示unavailable而非0。

- [ ] 在 `src/features/operations/capability-status.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t08_scenario_1`：配置存在但無成功證據=unverified，不是healthy；老成功但近期失敗=degraded。
  - `t08_scenario_2`：AI adapter已實作不再顯示沒code；missing scanner不使完全無關的只讀頁失敗。
  - `t08_scenario_3`：API token／signed URL／DB host secret不出現在response／log快照。
- [ ] 執行 `npm run test -- src/features/operations/capability-status.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 狀態可追到特定部署的job/probe，不以硬編碼BLOCKED清單作即時真相。

## T09 · Phase 3 · 共用可恢復批次操作核心

**Dependencies:** T01, T02
**Audit coverage:** K07, K22

**Files — Modify / inspect:**
- 無；新增垂直模組，重用既有domain services。

**Files — Proposed create:**
- `src/features/bulk-operations/types.ts`
- `src/features/bulk-operations/repository.ts`
- `src/features/bulk-operations/server-fns.ts`
- `src/features/bulk-operations/runner.ts`

**Interfaces:** previewBulkOperationForActor(actor,input:BulkPreviewInput):Promise<BulkPreview>；commitBulkOperationForActor(actor,{previewId,previewHash,idempotencyKey}):Promise<BulkOperation>；getBulkOperationForActor(actor,id):Promise<BulkOperationView>；cancelBulkOperationForActor(actor,id):Promise<void>。

**Decisions:** 使用 Postgres durable jobs／items，沿用既有SQL與maintenance scheduler，不引入第二工作流平台。選取ids或filter snapshot在server解析，快照存ID＋revision；先preview再commit。每item transaction同時寫業務、audit及item結果；失權／revision變動=conflict／forbidden。logicalOperation去重不能只靠request key。cancel只停止未開始項；對不可逆send只建立draft，實際發送走T06。

- [ ] 在 `src/features/bulk-operations/repository.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t09_scenario_1`：兩人同時改同case，後者conflict而不是覆寫。
  - `t09_scenario_2`：worker在business write後重啟不重复寫；部分成功＋retry只重跑可安全失敗。
  - `t09_scenario_3`：preview後角色停用／scope改變必須重驗；allMatching快照不自動吸收新增列。
- [ ] 執行 `npm run test -- src/features/bulk-operations/repository.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 新增forward migration保存operation／item／attempt／preview；100／1000項可追進度並export安全CSV。

## T10 · Phase 3 · 月表 mapping、語意版本與 preview diff

**Dependencies:** T01, T02
**Audit coverage:** K08, K09, K10

**Files — Modify / inspect:**
- `src/routes/imports.tsx`
- `src/features/nar-import/repository.ts`
- `src/features/nar-import/server-fns.ts`
- `src/features/nar-import/mapping.ts`
- `src/features/nar-import/normalize.ts`

**Files — Proposed create:**
- `src/features/nar-import/preview.ts`

**Interfaces:** searchImportCompaniesForActor(actor,{q,cursor,limit}):Promise<CompanyPage>；revalidateNarImportForActor(actor,{batchId,expectedRevision}):Promise<ImportPreview>；ImportPreview={id,revision,semanticKey,rows,counts,previewHash}。

**Decisions:** company mapping查所有授權公司含已有案件者，不再用new-case eligibility。保留raw workbook hash；semanticKey另含sheet、returnYear、parserVersion、mappingRevision。同bytes不同年度建立不同preview語意。mapping成功重算受影響未apply列；已apply列不悄改。preview每欄before/after/source/policy；既有正確人工值不被空值／Nil覆蓋。

- [ ] 在 `src/features/nar-import/preview.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t10_scenario_1`：三現有公司都能mapping；無權限公司不可被搜索／映射。
  - `t10_scenario_2`：同檔mapping後counts立即更新；同檔不同年度不復用錯年度。
  - `t10_scenario_3`：Excel serial dates／文字日期／空白／Nil／formula cache、重複externalID及名字相似但CR不同各有明確issue。
- [ ] 執行 `npm run test -- src/features/nar-import/preview.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 分頁review與遠端company search；查詢故障顯示error；不透過重新上載修復mapping。

## T11 · Phase 3 · 月表 approve／apply／resume

**Dependencies:** T09, T10, T03
**Audit coverage:** K07, K09

**Files — Modify / inspect:**
- `src/features/nar-import/repository.ts`
- `src/features/nar-import/server-fns.ts`
- `src/routes/imports.tsx`

**Files — Proposed create:**
- `src/features/nar-import/apply.ts`

**Interfaces:** approveNarImportForActor(actor,{previewId,previewHash}):Promise<ImportApproval>；applyNarImportForActor(actor,{approvalId,idempotencyKey}):Promise<BulkOperation>。

**Decisions:** 以company+returnYear建立／更新case；新增公司需已核實CR等必填資料＋明確Create選擇，資料不足保持unresolved，不能猜。欄位政策見CONTRACTS；payment date只建立待核對觀察，不直接Payment received；現有Filed／Completed不降級，文件不自動Verified。外部ID映射衝突先解決。逐列原子transaction，批次允許部分成功；apply不發通知。

- [ ] 在 `src/features/nar-import/apply.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t11_scenario_1`：重播同檔／同preview不同request key都不重複case／payment observation。
  - `t11_scenario_2`：preview後case被人修改→conflict，重驗再批准；途中失敗可resume。
  - `t11_scenario_3`：不同兩列命中同company+year：merge conflict或一致skip，不last-write-wins。
  - `t11_scenario_4`：Nil、空白不刪人工值；filed案件不被月份匯入重新開啟。
- [ ] 執行 `npm run test -- src/features/nar-import/apply.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 建立一份有新增、更新、跳過、錯誤列的匿名fixture，export結果每行可追原row及audit。

## T12 · Phase 3 · 文件上載、安全掃描與人工審閱可營運

**Dependencies:** T01, T02, T07, T08
**Audit coverage:** K02, K19

**Files — Modify / inspect:**
- `src/features/documents/server-fns.ts`
- `src/features/documents/repository.ts`
- `src/features/documents/scan-worker.ts`
- `src/features/documents/live-scanner.ts`
- `src/features/documents/versions.ts`
- `src/features/annual-return/evidence-service.ts`
- `src/routes/documents.tsx`

**Files — Proposed create:**
- 不新增平行模組；優先就地修復。

**Interfaces:** 沿用UploadIntent／DocumentVersion／ScanJob模型；reviewDocumentVersionForActor(actor,{documentVersionId,expectedVersion,decision,reason}):Promise<ReviewResult>，若現已有等價入口擴充而不另造並行流程。

**Decisions:** 上載→hash stored bytes→quarantine→scanner→clean→requirement matching→human decision；重掃／replacement invalidate舊manifest approval。R2私有下載在server重驗scope與scan，不因UI button disabled當保護。無scanner供應商時不可fake clean；可完成adapter contract/local fixtures但runtime保持blocked。

- [ ] 在 `src/features/documents/document-lifecycle.integration.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t12_scenario_1`：偽MIME／惡意內容／scanner timeout／404 object／hash mismatch維持quarantine並可診斷。
  - `t12_scenario_2`：同檔重傳按既有版本政策處理且不覆蓋audit；替換版本舊approve不可通用。
  - `t12_scenario_3`：Client A下載Client B文件被拒；expired signed URL不可再用；clean sample可由授權staff閱覽／覆核。
- [ ] 執行 `npm run test -- src/features/documents/document-lifecycle.integration.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 本機contract測試之外，需要獲批供應商的實際非敏感樣本成功掃描證據；人工外部scan紀錄不冒充系統clean。

## T13 · Phase 3 · 付款觀察、證據配對及覆核

**Dependencies:** T09, T12, T03
**Audit coverage:** K02, K07

**Files — Modify / inspect:**
- `src/routes/payments.tsx`
- `src/features/annual-return/evidence-server-fns.ts`
- `src/features/annual-return/evidence-service.ts`
- `src/features/annual-return/repository.ts`

**Files — Proposed create:**
- `src/features/payments/reconciliation.ts`
- `src/features/payments/server-fns.ts`

**Interfaces:** PaymentObservation={id,companyId,caseId?,invoiceRef?,amountMinor?,currency?,receivedOn?,sourceRowId?,revision}；reconcilePaymentForActor(actor,{observationId,caseId,proofVersionId,expectedRevision,decision,reason}):Promise<PaymentReconciliationResult>。

**Decisions:** 以現有payments為canonical，不另造競爭payment status；新增observation／allocation只補證據。金額用integer minor units或DB numeric，不binary float；資料沒有金額／invoice就未知，不估計。預設每proof allocation具唯一性，合法分攤需明確分配及總額檢查；不自動把近似公司名配成款。

- [ ] 在 `src/features/payments/reconciliation.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t13_scenario_1`：import received-date無proof保持pending；proof屬其他公司拒絕。
  - `t13_scenario_2`：duplicate reference／付款重複allocation／partial／overpayment成exception；多幣別不可混加。
  - `t13_scenario_3`：覆核後刷新readiness；失權及stale revision拒絕，audit含before/after及proof version。
- [ ] 執行 `npm run test -- src/features/payments/reconciliation.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 單筆與batch都用同service；不能只改status繞過證據與授權。

## T14 · Phase 4 · 批准 manifest 與可下載文件包

**Dependencies:** T03, T12, T13
**Audit coverage:** K17

**Files — Modify / inspect:**
- `src/features/annual-return/package-manifest.ts`
- `src/features/annual-return/requirements.ts`
- `src/features/annual-return/components/production-case-detail.tsx`

**Files — Proposed create:**
- `src/features/annual-return/package-service.ts`
- `src/features/annual-return/package-download.ts`

**Interfaces:** preparePackageForActor(actor,{caseId,expectedRevision}):Promise<PackageDraft>；approvePackageForActor(actor,{packageId,manifestHash,expectedRevision}):Promise<PackageApproval>；downloadApprovedPackageForActor(actor,packageId):Promise<AuthorizedDownload>。

**Decisions:** 重用現有immutable manifest及human decision，包內文件按manifest的version／page引用，產物hash存R2。批准權限繼承現有permission而非任意放寬。生成ZIP／PDF package失敗可恢復，但prepare不能讓case變Filed。下載link短效、私有、每次授權；filename安全化。

- [ ] 在 `src/features/annual-return/package-service.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t14_scenario_1`：文件替換／付款撤銷／requirement改變後manifest hash失效，需重新批准。
  - `t14_scenario_2`：未clean或無human decision不能prepare可交件package。
  - `t14_scenario_3`：兩次download同approved artifact bytes/hash一致，另一公司Client不可取得。
- [ ] 執行 `npm run test -- src/features/annual-return/package-service.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 案件動作改名「準備文件包／批准／下載」，移除Submit packet假傳送語意。

## T15 · Phase 4 · 記錄人手外部交件

**Dependencies:** T14
**Audit coverage:** K17

**Files — Modify / inspect:**
- `src/features/annual-return/handoff.ts`
- `src/features/annual-return/handoff-destination.ts`
- `src/features/annual-return/components/production-case-actions.ts`

**Files — Proposed create:**
- `src/features/annual-return/submission-service.ts`

**Interfaces:** recordManualSubmissionForActor(actor,{packageId,manifestHash,submittedAt,destinationLabel,externalReference,proofVersionId,expectedRevision}):Promise<SubmissionRecord>。

**Decisions:** 沿用既有handoff table可加submissionMode=manual/external-api，不把內部伺服器當外部目的地。manual提交需已批准包＋外部reference＋clean證明及操作者；server再次檢查包未變。recorded-submission只表示已登記交件，accepted/Filed/Completed 依現有業務規則及回執證據推进；未決定時保持獨立子狀態，禁止早結案。

- [ ] 在 `src/features/annual-return/submission-service.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t15_scenario_1`：雙擊／重放同reference只一筆；不同包試用舊approval拒絕。
  - `t15_scenario_2`：缺proof／future timestamp超合理誤差／未授權actor拒絕，使用HKT輸入UTC存儲。
  - `t15_scenario_3`：下載過包但未記錄提交：不可顯示已傳送／Filed。
- [ ] 執行 `npm run test -- src/features/annual-return/submission-service.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 無任何外部API connector也能完成人手提交記錄；「外部系統已收到」必須有證據，不由按鈕點擊推斷。

## T16 · Phase 4 · 內部伺服器回件與異常處理

**Dependencies:** T15, T12, T07
**Audit coverage:** K17

**Files — Modify / inspect:**
- `src/features/annual-return/handoff.ts`
- `src/features/annual-return/work-views.ts`

**Files — Proposed create:**
- `src/features/annual-return/return-source.ts`
- `src/features/annual-return/return-service.ts`

**Interfaces:** ReturnSource.list(cursor):Promise<ReturnSourcePage>；ReturnSource.read(objectId):Promise<ReturnObject>；ingestReturnForActor(actor,input:ReturnIntake):Promise<ReturnRecord>；reconcileReturnForActor(actor,{returnId,submissionId,expectedRevision,decision,reason}):Promise<ReturnDecision>。

**Decisions:** 先做正式manual return upload fallback，與connector共用intake；未提供protocol/credentials不能假接通。source object identity＋hash去重；partial upload等穩定檔再讀。externalReference／manifest hash／公司與年度作候選比對，模糊匹配只建建議；沒有hash的真實回件允許人核對reference＋證據後具名確認，不能純自動拒掉所有舊回件。accepted/rejected/partial/unmatched/duplicate分開。

- [ ] 在 `src/features/annual-return/return-service.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t16_scenario_1`：同檔重讀只一筆；不同內容同檔名保留版本；多候選保持unmatched。
  - `t16_scenario_2`：拒件／部分回件保持exception，即使已匹配；只有accepted且人工核對才解除。
  - `t16_scenario_3`：connector中断續cursor；惡意附件quarantine；manual intake不冒稱source sync成功。
- [ ] 執行 `npm run test -- src/features/annual-return/return-service.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 今天的回件與異常清單真實可用；internal source只讀、不刪遠端檔；live connector待具體protocol與測試folder授權。

## T17 · Phase 5 · WhatsApp 連線、webhook 與指定測試驗證

**Dependencies:** T06, T07, T08
**Audit coverage:** K03

**Files — Modify / inspect:**
- `src/features/whatsapp/config.ts`
- `src/features/whatsapp/webhook.ts`
- `src/features/whatsapp/woztell.ts`
- `src/features/whatsapp/server-fns.ts`
- `src/server/runtime-env.ts`

**Files — Proposed create:**
- 不新增平行模組；優先就地修復。

**Interfaces:** 延續現有WhatsAppProviderConfig／webhook raw-body HMAC；getWhatsAppIntegrationStatusForActor 回傳CapabilityStatus＋missingBindingNames，不回傳secret。

**Decisions:** 先按當時官方WOZTELL文件核對endpoint/auth/signature/template/media能力與idempotency，不以審核假設造API。金鑰只存deployment secret，管理UI只呈遮罩狀態及runbook。webhook去重且receipt亂序不能使read退回sent。連線probe不送訊息；只有已明確批准的目的及收件人才做real-send smoke。

- [ ] 在 `src/features/whatsapp/provider-contract.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t17_scenario_1`：invalid signature／replay／duplicate／out-of-order receipts／unknown provider message ID有明確結果。
  - `t17_scenario_2`：simulated與live的delivery欄位不同，fake providerID不進正式記錄。
  - `t17_scenario_3`：四個required binding缺任一仍blocked；恢復後需正確的last success才healthy。
- [ ] 執行 `npm run test -- src/features/whatsapp/provider-contract.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 指定非客戶測試號碼完成inbound→outbound→receipt；沒有收件人授權時只完成contract測試並保留runtime gate。

## T18 · Phase 5 · 案件聯絡人、直接回覆與實際送出預覽

**Dependencies:** T17, T03
**Audit coverage:** K18, K22

**Files — Modify / inspect:**
- `src/features/whatsapp/components/production-inbox.tsx`
- `src/features/whatsapp/server-fns.ts`
- `src/features/whatsapp/session-window.ts`
- `src/features/whatsapp/approved-templates.ts`
- `src/features/annual-return/components/production-whatsapp-automation.tsx`
- `src/features/clients/components/production-client-detail.tsx`

**Files — Proposed create:**
- `src/features/whatsapp/message-preview.ts`

**Interfaces:** prepareMessageForActor(actor,{caseId,conversationId?,contactId,purpose,draft}):Promise<MessagePreview>；queueApprovedMessageForActor(actor,{previewId,previewHash,idempotencyKey}):Promise<DeliveryRef>。

**Decisions:** 聯絡人用role＋verified E.164＋語言；case、conversation、contact三者一致且受權限。預覽把實際sendMode/templateName/language/components/renderedText凍結；24h window在dispatch重驗，mode需變則重新預覽／批准，不默默用空variables fallback替換。documents outstanding從最新版本查；fixture不可排程。

- [ ] 在 `src/features/whatsapp/message-preview.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t18_scenario_1`：預覽後跨過session截止、template被停用、contact變更、case完成：舊preview不可送。
  - `t18_scenario_2`：同一電話多公司必須明示case context；回覆保留conversation及audit。
  - `t18_scenario_3`：client contact不存在顯示建立/修正入口；不要求職員反覆手填電話。
- [ ] 執行 `npm run test -- src/features/whatsapp/message-preview.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 直接回覆與automation共用outbox，不新增直接fetch provider的旁路。

## T19 · Phase 5 · WhatsApp 附件下載至案件文件

**Dependencies:** T12, T17, T18
**Audit coverage:** K18

**Files — Modify / inspect:**
- `src/features/whatsapp/repository.ts`
- `src/features/whatsapp/webhook.ts`
- `src/features/documents/scan-jobs.ts`

**Files — Proposed create:**
- `src/features/whatsapp/media-download.ts`

**Interfaces:** fetchInboundMedia(mediaRef:ProviderMediaRef):Promise<QuarantinedMedia>；linkInboundMediaForActor(actor,{messageId,mediaIndex,caseId,requirementInstanceId?,expectedRevision}):Promise<DocumentVersionRef>。

**Decisions:** 保存provider reference後在background下載，僅官方allowlisted endpoint，不跟任意remote URL／redirect。設定size/MIME/timeout，寫私有storage＋hash後走同scan pipeline。唯一鍵providerMessageId+mediaIndex；多公司對話先待配對，不能猜owner。expired URL需有官方refresh機制，沒有就request manual reupload。

- [ ] 在 `src/features/whatsapp/media-download.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t19_scenario_1`：重覆webhook／下載重試不重複version；expired link／oversize／wrong MIME／SSRF URL安全拒絕並可追錯誤。
  - `t19_scenario_2`：附件未clean不能預覽下載或滿足requirement；classify錯誤可人工修正且有audit。
- [ ] 執行 `npm run test -- src/features/whatsapp/media-download.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** WOZTELL media API合約缺失時保留可測adapter+manual route，不能標live complete。

## T20 · Phase 6 · Admin 職員生命週期與權限交接

**Dependencies:** T01, T02, T09
**Audit coverage:** K11

**Files — Modify / inspect:**
- `src/routes/admin.tsx`
- `src/features/auth/authorization.ts`
- `src/features/auth/session.ts`
- `src/features/auth/neon-auth-server.ts`

**Files — Proposed create:**
- `src/features/staff-admin/repository.ts`
- `src/features/staff-admin/server-fns.ts`
- `src/features/staff-admin/auth-provider.ts`

**Interfaces:** inviteStaffForActor(actor,input:StaffInvitationInput):Promise<InvitationStatus>；changeStaffAccessForActor(actor,{staffId,role,teamId,expectedRevision}):Promise<StaffProfile>；disableStaffForActor(actor,{staffId,expectedRevision,handoverOperationId?}):Promise<DisableResult>。

**Decisions:** 先沿用既有server角色邊界，Admin可管理，Manager/Staff不可升權。provider invite與DB profile非同一transaction，使用pending/provider-created/linked/failed provisioning狀態及idempotent reconcile。核對當時Neon Auth官方管理API；不自行造create-user endpoint。停用即在app authorization拒絕，即使provider revoke尚失敗；保留歷史名字，不刪audit。交接用T09受權限batch，需可見未交接餘額。

- [ ] 在 `src/features/staff-admin/lifecycle.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t20_scenario_1`：最後active Admin不可停用或降級；兩個Admin同時降級以DB lock保證至少一位。
  - `t20_scenario_2`：invite provider成功但DB失敗可reconcile，不重發多封invite；pending不能當active。
  - `t20_scenario_3`：停用者既有session被server拒绝；跨team提權／self escalation拒絕；交接只轉合法case及work item。
- [ ] 執行 `npm run test -- src/features/staff-admin/lifecycle.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 實際invite email/存取權擴大依執行環境要求取得明確批准；沒有provider管理能力仍完成local可驗證部分並報blocker。

## T21 · Phase 6 · 真實模板版本、使用量及變更影響

**Dependencies:** T03, T09
**Audit coverage:** K15, K22

**Files — Modify / inspect:**
- `src/routes/settings.tsx`
- `src/features/checklist-templates/repository.ts`
- `src/features/checklist-templates/server-fns.ts`

**Files — Proposed create:**
- `src/features/checklist-templates/usage.ts`

**Interfaces:** listTemplateUsageForActor(actor,{templateVersionId,cursor}):Promise<TemplateUsagePage>；previewTemplateRolloutForActor(actor,{fromVersion,toVersion,selection}):Promise<BulkPreview>。

**Decisions:** 從正式case snapshot/reference聚合；未知legacy templateVersion顯示unknown usage，不猜private template。draft→published immutable version；默认只影響新案。既有案批次套用需preview requirement diff且不覆蓋verified evidence；已交件／結案排除。刪除已使用版本改archive；明確Saving/Saved/Failed與retry。

- [ ] 在 `src/features/checklist-templates/usage.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t21_scenario_1`：mock20不可出現；usage可點入正確case scope。
  - `t21_scenario_2`：套用新required document使readiness重算；原證據保留；不同同事同時改模板产生revision conflict。
- [ ] 執行 `npm run test -- src/features/checklist-templates/usage.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 不能把template更新當case批量批准；使用量與current filter範圍有標籤。

## T22 · Phase 6 · 案件、客戶與工作分派批量 UI

**Dependencies:** T09, T04, T05
**Audit coverage:** K22, K12

**Files — Modify / inspect:**
- `src/features/annual-return/components/production-command-center.tsx`
- `src/features/clients/components/production-client-register.tsx`
- `src/routes/work-queue.tsx`

**Files — Proposed create:**
- `src/components/bulk-selection-toolbar.tsx`
- `src/features/bulk-operations/assignment-handler.ts`

**Interfaces:** assignment handler消費BulkPreviewInput(action="assign")；選取selectionContract保持由T09解讀。

**Decisions:** 提供本頁／全部符合filter兩種選取、取消、受限數量、sticky toolbar、preview old/new owner＋team。case owner及linked work item在同transaction按既有ownership規則同步；不可失敗一半。提供tags及可授權CSV export；CSV公式escape以避免spreadsheet execution。

- [ ] 在 `src/features/bulk-operations/assignment-handler.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t22_scenario_1`：跨頁401項選取無duplicate，filter改變清選取並通知；只重試failed項。
  - `t22_scenario_2`：跨team／inactive owner／已locked case逐項拒；其餘成功而非全部靜默失敗。
- [ ] 執行 `npm run test -- src/features/bulk-operations/assignment-handler.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 保存篩選與返回位置；large batch進度可離頁恢復；export不洩露未授權列。

## T23 · Phase 6 · 批量追件草稿及批准傳送

**Dependencies:** T09, T18, T22
**Audit coverage:** K18, K22, K04

**Files — Modify / inspect:**
- `src/features/annual-return/components/production-whatsapp-automation.tsx`

**Files — Proposed create:**
- `src/features/bulk-operations/reminder-handler.ts`

**Interfaces:** preview reminder handler產生每case/contact MessagePreview；commit建立draft review operation；send子步只queueApprovedMessageForActor。

**Decisions:** 區分批量建立draft與實際批准送出；去重鍵case+purpose+cadence slot+contact，不能只按電話合併不同公司內容。fixture／完成案／cooldown／無號碼／缺template逐項skip with reason。preview後任何內容／mode變動須重驗；限速沿用provider限制與job concurrency。

- [ ] 在 `src/features/bulk-operations/reminder-handler.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t23_scenario_1`：同批重播只一logical reminder；同電話兩家公司保持context而不錯合。
  - `t23_scenario_2`：一項送出unknown不重試整批；成功provider receipt仍在batch結果可追。
- [ ] 執行 `npm run test -- src/features/bulk-operations/reminder-handler.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 真實收件人批准由使用者完成；實作agent不因測試計劃而向客戶發訊息。

## T24 · Phase 6 · 文件、付款與交件批量維護

**Dependencies:** T09, T12, T13, T14, T15, T16
**Audit coverage:** K22, K17

**Files — Modify / inspect:**
- 無；新增垂直模組，重用既有domain services。

**Files — Proposed create:**
- `src/features/bulk-operations/evidence-handler.ts`
- `src/features/bulk-operations/payment-handler.ts`
- `src/features/bulk-operations/package-handler.ts`

**Interfaces:** 各handler只呼叫T12/T13/T14/T15/T16單項服務；BulkAction 增 classifyDocuments、assignReview、retryAnalysis、reconcilePayments、preparePackages、recordSubmissions、matchReturns。

**Decisions:** 文件批次只分類／分派／可安全retry，不能一鍵全部human approve。付款每項必須有唯一證據與allocation。package批量準備不等於批准／交件；record submission每项要求對應proof與reference；回件模糊matching只建候選。提供失敗CSV及人工處理隊列。

- [ ] 在 `src/features/bulk-operations/domain-handlers.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t24_scenario_1`：任何批量接口不能跳過單項readiness／scan／permissions／revision。
  - `t24_scenario_2`：部分付款proof衝突、package stale、回件duplicate只影響該項並有可解釋結果。
- [ ] 執行 `npm run test -- src/features/bulk-operations/domain-handlers.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 只加入已有可用單項服務的action；未通過provider/runtime gate的action保持disabled＋原因，不裝作成功。

## T25 · Phase 7 · 文件文字層、OCR 與案件 context AI

**Dependencies:** T12, T03, T08
**Audit coverage:** K19

**Files — Modify / inspect:**
- `src/features/documents/ai-provider.ts`
- `src/features/documents/analysis-worker.ts`
- `src/features/documents/analysis-checks.ts`
- `src/features/documents/text-extraction.ts`
- `src/features/documents/findings.ts`

**Files — Proposed create:**
- `src/features/documents/analysis-context.ts`
- `src/features/documents/ocr-provider.ts`

**Interfaces:** AnalysisContext={caseId,company:{id,name,crNumber},returnYear,partySnapshot,requirementSnapshot,documentVersionId,contentSha256,ruleSetVersion,contextHash}；AnalysisEvidence={page,quote?,bbox?,extractionMethod,sourceVersionId}。

**Decisions:** 只對clean bytes先text-layer，無足够文字才OCR；OCR adapter依獲批provider文件配置。context由server authorization生成，輸入文件視為不可信資料而非指令。記錄model/prompt/rule版本、contextHash、cost／latency；公司/party/requirement修改後舊結果stale。遵守現有blocksRelease信任層級，模型finding不直接決定放行或權威block；人工覆核與deterministic checks保持清晰。

- [ ] 在 `src/features/documents/analysis-context.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t25_scenario_1`：錯公司／CR／年度／人士、頁數不符、缺頁、影像PDF、低可信度、惡意文檔指令及provider timeout不當作pass。
  - `t25_scenario_2`：每finding可追到頁碼／quote／version；幻覺引用找不到原文則uncertain。
  - `t25_scenario_3`：模型只輸出schema，無法呼叫approval／send／下載任意URL。
- [ ] 執行 `npm run test -- src/features/documents/analysis-context.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 先用匿名golden corpus驗證，再獲批non-sensitive live樣本；沒有OCR/AI設定時明確human-only，不能fake analysis。

## T26 · Phase 7 · 日常操作 UX 及 zh-HK 一致性

**Dependencies:** T03, T05, T08, T18, T22
**Audit coverage:** K22, K24, K02

**Files — Modify / inspect:**
- `src/routes/today.tsx`
- `src/routes/portal.tsx`
- `src/routes/work-queue.tsx`
- `src/features/annual-return/components/production-command-center.tsx`
- `src/features/annual-return/components/production-case-detail.tsx`

**Files — Proposed create:**
- `src/features/runtime/operational-copy.ts`

**Interfaces:** OperationalAction={kind,label,href?,disabledReason?}；由readiness/blocker映射，不由UI猜status。

**Decisions:** 每列一個下一步；案詳情分文件／付款／訊息／交件回件／audit並可deep link。sticky公司與action欄；公司名可點；統一zh-HK、HKT。error、empty、blocked提供下一步及負責角色，技術IDs收折。延續PageHeader唯一h1；dialog focus、鍵盤操作、aria labels與非顏色風險標示。

- [ ] 在 `src/routes/-daily-work.audit-ux.test.tsx` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t26_scenario_1`：1440／1280／768／390px主要動作可見，不必橫捲才能Open；mobile允許card但不丟信息。
  - `t26_scenario_2`：今日追件直達reminder context；新文件直達相應version review；返回保留filter/scroll。
  - `t26_scenario_3`：screen-reader可辨相同名按鈕對應公司；focus可離開dialog，disabled有原因。
- [ ] 執行 `npm run test -- src/routes/-daily-work.audit-ux.test.tsx`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 用before/after screenshot＋完成一宗追件/覆核步驟數對比；不為簡單文案另造大量鏡像tests。

## T27 · Phase 7 · 大量案件及月表效能

**Dependencies:** T03, T04, T10, T11, T09
**Audit coverage:** K23

**Files — Modify / inspect:**
- `src/features/annual-return/server-fns.ts`
- `src/features/annual-return/repository.ts`
- `src/features/annual-return/work-views.ts`
- `src/routes/imports.tsx`

**Files — Proposed create:**
- `scripts/benchmark-operations.ts`
- `docs/runbooks/performance-baseline.md`

**Interfaces:** listWorkViewForActor(actor,{view,filters,cursor,limit,asOf}):Promise<WorkViewPage>；getOperationalMetricsForActor(actor,{scope,asOf}):Promise<OperationalMetrics>。

**Decisions:** 移除interactive path上的listAllCases／5000 scan cutoff，用SQL filters+aggregates，同一asOf快照；不要在risk postfilter後丟掉nextCursor。pageSize預設50、max200；匯入virtualize或paginate，不每列載全部companies。先EXPLAIN local clone，再按實測加索引；讀取connection／DB/R2 region與pool topology再決定調整。

- [ ] 在 `src/features/annual-return/work-view-pagination.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t27_scenario_1`：1k/10k/超20k案件總數正確不截斷；深頁穩定，count與rows同scope。
  - `t27_scenario_2`：10k月表scroll不產生10k DOM row或company dropdown copies；parse/apply background可恢復。
  - `t27_scenario_3`：記錄cold/warm p50/p95、query count、payload、DOM count、memory；slow-provider不阻塞普通list。
- [ ] 執行 `npm run test -- src/features/annual-return/work-view-pagination.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 工程目標（非既有SLA）：warm list API p95≤1s、summary≤1s、首屏page payload≤300KB（不含bundle／檔案）；若未達，附profiling與修复，不能改小資料集冒充達標。

## T28 · Phase 7 · 其餘新服務與客戶資料完整驗收

**Dependencies:** T01, T02, T12, T20, T21
**Audit coverage:** Audit 功能狀態／剩餘服務驗收

**Files — Modify / inspect:**
- `src/features/incorporation/workflow.ts`
- `src/features/incorporation/repository.ts`
- `src/features/incorporation/server-fns.ts`
- `src/features/corporate-changes/workflow.ts`
- `src/features/corporate-changes/repository.ts`
- `src/features/corporate-changes/server-fns.ts`
- `src/features/clients/repository.ts`
- `src/features/service-subscriptions/repository.ts`

**Files — Proposed create:**
- 不新增平行模組；優先就地修復。

**Interfaces:** 保留現有IncorporationStatus／CorporateChangeStatus與typed server functions；用既有repo合約補缺，不另創全產品generic case engine。

**Decisions:** 在隔離資料庫跑incorporation由intake到approval／公司建立、corporate name/share/officer/address四類、officer/shareholding/controller/contact/subscription CRUD。完成變更才更新canonical company register，case取消不應留下半套主資料；有效日期與audit保留。訂閱提醒只產生draft並走outbox；WeChat目前無經此audit驗證的adapter，列獨立依賴，不冒稱已完成。

- [ ] 在 `src/features/incorporation/service-lifecycle.integration.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t28_scenario_1`：跳過狀態／未知enum／跨company mutation拒絕；完成重放只建立一次公司或register變更。
  - `t28_scenario_2`：公司更名／董事退出後，既有申報party snapshot不被歷史改寫。
  - `t28_scenario_3`：subscription duplicate reminder被防重；Client只可見所屬公司且不可管理staff。
- [ ] 執行 `npm run test -- src/features/incorporation/service-lifecycle.integration.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 補src/features/corporate-changes/service-lifecycle.integration.test.ts；各服務提供happy path與取消／失敗證據；發現新缺陷加入有owner的task，不能只標入口存在。

## T29 · Phase 8 · 角色、遷移、端到端與分段發佈

**Dependencies:** T00, T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19, T20, T21, T22, T23, T24, T25, T26, T27, T28
**Audit coverage:** K01, K02, K03, K04, K05, K06, K07, K08, K09, K10, K11, K12, K13, K14, K15, K16, K17, K18, K19, K20, K21, K22, K23, K24

**Files — Modify / inspect:**
- `.github/workflows/ci.yml`
- `docs/runbooks/pilot-operations.md`
- `docs/runbooks/backup-restore.md`

**Files — Proposed create:**
- `docs/runbooks/release-acceptance-2026-09-27.md`
- `docs/runbooks/kossilon-staff-quick-start-zh-HK.md`

**Interfaces:** ReleaseEvidence={commitSha,deploymentId,migrationIds,roleMatrix,scenarioResults,scheduledRuns,providerChecks,performance,knownBlocks,rollbackRef}。

**Decisions:** 按04_RELEASE_AND_TESTS執行完整role matrix與E2E；每個runtime integration獨立標local-passing/configured/runtime-verified/pilot-accepted。保留所有既有CI，修正platform-specific cron gate以測真正deploy target，不刪test放行。先內部pilot少量授權案件，再允許bulk，最後擴大用戶。

- [ ] 在 `src/features/auth/operations-role-matrix.test.ts` 先加入下列具名場景的 failing tests（測試名稱以英文語意對應）。
  - `t29_scenario_1`：Admin/Manager/Staff/Client/disabled/anonymous：所有讀写／下載／bulk／direct server fn都覆蓋越權。
  - `t29_scenario_2`：從月表→追件draft→文件clean/review→付款→package→人手submission→回件→complete全鏈可追。
  - `t29_scenario_3`：provider停機／schema mismatch／restore rehearsal／duplicate trigger／worker crash有可恢復結果。
- [ ] 執行 `npm run test -- src/features/auth/operations-role-matrix.test.ts`，確認RED源於上述預期缺陷。
- [ ] 按Interfaces與Decisions實作；若需migration，同PR附forward SQL與local升級測試。
- [ ] 重跑focused tests至GREEN，執行相關SQL／互動測試；依04文件跑適用CI gate，記錄實際pass/skip。
- [ ] 完成以下gate後review diff、commit並更新execution status；未有runtime證據只標local-passing。

**Gate / evidence:** 只把有證據的finding關閉；已部署不等於已驗收。外部依賴未具備時列blocked及所需最小輸入，交付其餘PR與測試，不填假成功。

---

# 04 · Tests, Runtime Gates and Release

## 1. 每個任務的固定執行循環

1. 先讀Files中的現有程式與相關tests；從current main建立最小可重現，修正假設後才寫code。
2. 為真實業務／失敗風險補測試；先跑RED，原因必須是預期缺陷，不能只是缺dependency或測試環境壞掉。
3. 實作最小變更，run focused test GREEN；需DB的測試在disposable本機Postgres完整migrate＋seed後跑。
4. 查看diff、型別與scope；同時改server-fns/repository/permissions的任務不可只做UI tests。
5. 任務gate滿足後Conventional Commit，更新06_EXECUTION_STATUS.csv；每PR列root cause、behavior change、驗證、migration、rollback及remaining runtime blockers。

## 2. 已在package.json／CI核實的指令

下列以審核SHA確認存在。T00若current scripts改變須記錄差異；不要發明npm script已存在。

```bash
bun install --frozen-lockfile
npm run lint
npm run typecheck
npm run test
npm run verify:firm -- --dry-run
npm run build
npm run verify:dev-server-imports
```

單個task：`npm run test -- <task的Test檔案路徑>`，例如 `npm run test -- src/features/notifications/delivery-attempts.test.ts`。對React互動檔亦同。若測試尚未建立，以新增檔為測試設計，不解讀成既有測試已存在。format只針對改動檔，不跑全repo formatter造成無關diff。

DB integration：先使用新的disposable local DB，`DATABASE_URL`供migrate/seed；`TEST_DATABASE_URL`指向同一個已migrate＋seed的local DB給repository tests。`DATABASE_SSL=disable`只用local fixture。CI原本Postgres17 service、Node22、Bun；不要把production URL複製到測試環境。只有local確認後才能跑 `npm run db:migrate` 及 `npm run db:seed`。整合測試如skip必须列為NOT RUN；禁止讓全綠的unit掩蓋跳過SQL tests。

## 3. 必跑驗收矩陣

| 維度 | 案例 | 必須看到 |
|---|---|---|
| Role／scope | Admin、Manager同/異team、Staff owner/reviewer/非owner、Client同/異company、disabled、anonymous | read/write/export/download/preview/polling逐項正確授權 |
| DB | fresh、現有舊schema upgrade、unknown ledger、missing schema、backfill重播 | 阻擋不兼容部署；保留history/FK；資料不可少 |
| Case | unpaid docs-complete、unknown files、superseded、Filed、Completed | 統一readiness與metrics，不早交件／重開 |
| Imports | mapping後同檔、不同year、重复公司列、Nil、日期混合、stale approval | 明確preview、無重複case、無靜默覆寫 |
| Bulk | 1、100、1000項、跨頁filter、角色被撤、部分失敗、cancel/resume | per-item outcomes，只有安全失敗重試 |
| Outbox | double scheduler、fixture race、accepted+DB fail、timeout、stale lease | 無盲目第二次send；unknown可見 |
| Files | 有害／不符MIME、大檔、scanner timeout、版本取代、跨client下載 | quarantine與授權維持，human decision可追 |
| WhatsApp | no bindings、24h邊界、template缺失、duplicate webhook、亂序receipt、expired media | 真實preview及安全狀態；不假sent |
| Filing | package更換、重複提交、manual proof缺失、partial/unmatched回件 | approved bytes可追，異常不自動結案 |
| UX | 1440/1280/768/390px、keyboard/screen-reader、empty/error/loading | 主動作可達，無technical-ID作人名 |
| Performance | 1k/10k/>20k cases、10k月表、slowprovider | 無靜默截斷，測量p50/p95及query/DOM數 |
| Existing services | incorporation、4種corporate changes、register/subscriptions | 合法狀態、取消與主資料更新可回溯 |

## 4. 三條端到端測試旅程

**E2E-A 核心業務**：匿名月表中現有／新公司→配對/補欄→preview/approve/apply→case出現在今日工作→建立reminder draft（simulated標示）→經授權上載非敏感文件→真實/測試scanner模式明示→review→付款證據核對→approved immutable package→下載→登記人手外部提交證據→manual回件→人工核對accepted→Completed。每一步共享case ID、audit及版本，不能用直接DB修改跳過UI流程。

**E2E-B 支援與故障**：重播相同月表→部分行conflict→修正後retry；中途改owner權限；替換已批准文件→舊package不准交；模擬provider timeout→unknown，不重送；回件同名不同bytes→保留版本，unmatched待人處理。

**E2E-C 管理交接**：Admin邀請測試staff（實際email需批准）→provisioning連結→staff登入/權限→batch轉派→停用→舊session拒絕；最後Admin保護；模板版本發佈、usage與rollout preview；Client僅見本公司。

## 5. 外部依賴與可繼續工作

| 依賴 | 最小需要資料／決策 | 缺少時可完成 | 不可聲稱完成 |
|---|---|---|---|
| Production DB | 目標branch、ledger/catalog唯讀證據、備份、精確變更授權 | 本地migration/backfill及code | 正式schema已修好 |
| Runtime scheduler | active deployment SHA、平台/cron owner、觸發及歷史 | adapter、鎖、tests、runbook | 實際排程在跑 |
| WOZTELL | official contract、bindings、approved templates、指定測試號碼和目的批准 | contract fixtures、outbox/UI | 真實收送成功 |
| Scanner | approved vendor、接口、secret設定及測試樣本 | quarantine/adapter/retry | 真實文件已clean |
| AI/OCR | approved vendor/model、資料處理及成本設定 | context/rules/corpus、人手流程 | 自動內容核對可投產 |
| Return source | protocol、只讀folder、identity/credentials、sample回件 | manual return完整流程 | 內部server同步已連通 |
| Auth admin | 官方API/scopes、邀請策略與指定測試身份 | adapter/state machine/permissions | 真實invitation/revoke完成 |

不要在chat要求分享secret；用執行環境secret欄位或已有安全登入流程。只在具體external action需授權時提出精確請求；不重問已給過的相同授權。不能以欠一個vendor就把所有其他任務停掉。

## 6. 分段發佈及回復

Release 1：T01–T05＋T08只讀正確性，live sender保持原安全狀態。Release 2：T06/T07可靠job及T09–T16月表/人手閉環，以內部pilot驗收。Release 3：T17–T19指定測試對話及media後，按批准範圍開live。Release 4：Admin/bulk/AI/scale按各gate逐個啟用。每次只deploy已保存、已測試的exact SHA，記alias/DB migration/provider config revision，不用最新main代替部署證據。

使用既有feature/capability配置即可，新增開關只為需要獨立放行的能力；不要引入新feature-flag平台。先expand schema、部署兼容讀路徑、backfill/validate、再開寫能力；舊app rollback需能讀新schema。資料遷移失敗先停consumer、保持證據並依rehearsal恢復；不可用down migration刪業務證據。訊息送出、外部提交、已邀請郵件不可rollback，需停後續job及reconcile/補救。

Pilot最少覆蓋每條E2E與非Admin角色，連續3個scheduled tick及一次故障恢復。用戶確認業務結果後才擴大bulk及客戶資料範圍。Acceptance report附正式runtime證據，不能只截mock或test success。

## 7. Definition of Done

- 所有24個finding逐一有task、測試、commit、deployment或明確runtime blocker。
- 既有CI及新增risk tests通過；DB integration確實執行；demo仍read-only；没有fixture外發。
- 主要journey可完成，資料/證據/訊息/回件在同case串連，exception可處理，權限與bulk不能繞過規則。
- 支援runbook、staff quick start、Admin操作、可觀測job及rollback/補救文件可用。
- Runtime未驗證的能力保持unverified/blocked；不得把local passing宣稱production accepted。
