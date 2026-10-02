# 2026-10-01 審計修復：可審閱發布包

## 現況

**正式發布 NO-GO。** 十三個 development PR 已逐個通過新 head CI／真PG17／preview並以 merge commit 整合；最後 PR #102 待更新文件後的完整 gate 才合併 main。此 checkpoint main／live仍為 aa5d3cb，源碼 main 自動 Git 部署暫停設定會隨候選保留。正式 DB／env／發布／真收件人操作未獲本次 source merge 授權。最終合併及 main CI／live觀察回執記於 PR #102。

T00–T23 已有本地 source／測試證據，PR11為本分支的最後一包。T22匯總原50項：19 LOCAL ONLY pass／31blocked／0not_run，不刪或改原驗收。`verify:audit-release` 只讀 CSV、original JSON、SQL hashes，輸出 `localLedgerContract=PASS` 與獨立的 `productionReleaseGate=NO_GO`；exit0只表示台賬契約有效。

## 必須按順序核對的發布 gate

1. **Source review**：原十一個 PR 包及 B01–B04 已逐包覆核；十三個 development PR 整合後各自新 head 的完整 CI／真PG17／preview均通過。最後 PR #102 的更新 head 仍需獨立全綠，合併後再查 main CI及 live target。保留已發布歷史，無 force-push/rebase/squash；CI／preview綠色不等於 production完成。
2. **Schema／backup**：source50 IDs＝0001–0034＋0067–0082；last-observed production66歷史 IDs，且0034 ID與實體 marker DDL不一致。先在指定 branch 執行只讀 `release-preflight.sql`／`audit-schema-readiness.ts`，核對歷史0035–0066原始 SQL、hash、physical DDL及功能 lineage。**不得直接執行 `db:migrate` 或把整份 manifest 當待套用清單。** 詳見 schema-reconciliation.md。
3. **Recovery rehearsal**：provider 非 finalize recovery point／隔離 populated clone，確認端點沒有被移動。比較 row counts、FK、版本／ledger／outboxunknown，實際 restore 演練。沒有目標 recovery point／restore evidence 就保持 blocked；本地演練不替代 production restore。
4. **Concrete SQL approval**：只對已核對的 expand SQL及真正缺少的物理結構準備 transaction／advisory lock／lock timeout／前後 catalog counts；保留原 ledger與未知歷史。SQL真的執行且檢查通過才記其 receipt，不能偽造舊 ID。新正式 migration需要明確批准。
5. **Runtime staging**：核准 isolated Auth tenant／DB branch／R2 test prefix及existing controlled accounts。逐一提供五個角色的 fresh password session；magic-link／Google須另有真 callback／new-session證據。Finance／Reviewer映射現有角色，不新增權限。完成原50 UAT及以下核心journey，必要provider只用核准測試recipient。
6. **Application deploy**：核對 approved SHA、Web／Worker topology、兼容 schema、environment binding names、單一 scheduler owner及 feature capability gates。沿用實際現有 Vercel／Cloudflare配置，不憑空指定新平台。正式 deployment／切換要就具體SHA及目標取得授權。
7. **Activation**：scheduler先staging唯一native trigger三次真tick及pass-level outcome，再另行批准小批積壓。unknown派送先對賬，不全重試。Import／bulk首次小批需逐筆 preview/auth/version/idempotency/audit/partial outcomes，失敗有 resume/cancel。
8. **Observation**：至少一個完整工作日觀察 queue age／unknown／query error／核心journey／bulk partial failure／performance；每項有owner。尚未過觀察期保持未驗證。

## 已完成的本地 gate

- PR11 final source `102b983ac0b36e7fac07a65c4223d647bb244ac4`：Node22.23.3／Bun1.3.14／PG17，228files2179PASS0fail0skip345.53s；ChromeDEMO10PASS26.4s，含真正PDF parser/worker及錯persona拒絕；完整CI各gate PASS，lint0errors1existingwarning。Sole fresh review兩項Important各有RED/GREEN，一次修正，沒有rereview。完整 commands／exit／log hashes：`evidence/2026-10-02-pr11-gates.json`；source50SQL hashes：`evidence/2026-10-02-release-manifest.json`。
- PR10 sourcee09820c：Node22.23.3／Bun1.3.14／PG17，225files2171PASS0skip；build/typecheck/lint0errors1existingwarning/offline38reads0network0writes/dev12/compiledhookPASS；ChromeDEMO6PASS。本地0082 immutable snapshot／legacyNULL／rollback已演練。
- T21 owned synthetic10000cases／50000documents／164requests0errors，25users p95 Today525ms、Documents662ms；原 baseline／hardware／payload／query plans／cold-state限制在 performance.md。Staging budget／真角色／platform未驗收。
- T22已執行 existing support regressions：10files120PASS0skip79.27s，actualPG17。涵蓋 incorporation不跳步／單次公司建立／concurrent completion，corporate-change批准版本／取消／audit，subscription renewal/cancel及SCR，received-but-unreviewed追件契約。這些是local contracts，不是完整fresh-role流程。
- `test:e2e:audit -- --list` 實際 exit1：缺 `AUDIT_STAGING_ORIGIN`，沒有開啟staging browser／建立帳戶／發送登入信件。Runner只支援已有核准帳戶的fresh password landing，沒有把它命名為整個業務journey驗收。
- B02 PDF.js官方修補／兩個lock／real browser parser：見 security-triage.md；B03已按實際path相容patch，兩份audit0；完整gate證據在2026-10-02-b03-gates.json，仍不代表正式發布。

## 核心journey的真實驗收證據

1. 控制月表及原XLSX→mapping preview→current-version批准 apply，保存 row partial results／journal，重播不重複。
2. 公司／多party→年度案件→追件draft，fixture/historical不外發；Received不再追同一已收件，移到內部覆核。
3. ClientA fresh登入上載→真R2 bytes／checksum→真scanner verdict→Reviewer按current version覆核；ClientB不能讀metadata／bytes。
4. 付款入賬只基於current-version真證據／partial／duplicate／reasoned return，月表日期不等於已付款。
5. current-version批准package→實際安全ZIP→人手外部上載→提交證明，下載不等於交件。unknown外部結果不盲目retry。
6. 內部server真回件或manual intake→quarantine／scan／review→manifest＋case＋version核對→一次結案；另測退件／新版批准／stale409／replay。

每步記 deployed SHA、UTC/HK日期、verified actor、current version、provider reference／receipt及可引用證據。缺provider時停在該gate，不以mock/manual tick/existing session補PASS。

## 最小外部依賴／owner／下一步

| Gate                | 缺口                                                                                       | Owner／下一步                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| DB                  | production66歷史與source50差異；approved release SQL／clone restore未完成                  | DB／Release：核對原0035–0066來源、physical catalog、backup restore；批准精確SQL後才套用                   |
| Auth                | 無核准isolated origin／五個existing controlled accounts／fresh magic-link及Google evidence | Auth／業務：提供controlled tenant/branch identity與帳戶授權reference及安全bindings，不自動invite／grant   |
| R2／scanner         | bindings presence≠bytes roundtrip；真scanner protocol／token／verdict未驗證                | Storage／Security：核准test prefix、synthetic files及真scan receipt；保留quarantine                       |
| OCR／AI             | 核准endpoint／model／credentials／真human-labelled corpus及accuracy未知                    | Provider／Reviewer：提供blurred/rotated corpus、grounded引用、timeout／cost及precision/recall evidence    |
| WOZTELL             | last-observed Vercel四個bindings及approved media hosts absent；CF未知                      | Messaging／Security：官方協定及scoped channel/token、核准測試recipient、真receipt／unknown reconciliation |
| Handoff             | 真destination contract／rights／receipt／timeout回件未提供                                 | Filing／internal-server owner：核准目的地、真reference／return protocol；manual與auto分開驗收             |
| Scheduler           | CFtopology未知、staging單trigger／三次native ticks未驗證                                   | Operations：確認實際trigger/owner/schema/origin/recipient，保存平台delivery logs；manual不算              |
| UAT／性能           | 真角色核心與支援journeys及staging budget尚缺                                               | 業務／Release：完成CSV31blocked及staging p95/cold-cache/完整工作日觀察                                    |
| Dependency security | B03兩份當日audit0，source26ef92d；實際path／原始證據保留                                   | Security／Release：按固定Bun1.4.2／兩份lock重跑audit與platform gates；真corpus／provider另驗收            |

## 待正式批准時可執行的現有命令

以下只在已核對目標／SHA／rollback並取得所需授權後執行；不是本次已執行的正式操作。

```sh
bun install --frozen-lockfile
npm run verify:audit-release
bun scripts/audit-schema-readiness.ts
# db:migrate refuses historical divergence. Use only after reviewed reconciliation:
# bun scripts/db-migrate.ts
npm run verify:firm -- --dry-run
npm run build
# Existing actual platform commands require approved target/build:
# vercel --prod  (only for the verified linked Vercel project)
# npx nitro deploy --prebuilt (only for the verified Worker target)
```

不得在未釐清雙runtime／schema／sole-trigger前把兩個部署命令一起執行。正式回復見 rollback-runbook.md；所有單feature操作與provider contracts沿用現有runbooks。

## B03 dependency gate refresh

26ef92d3f7346e929271ff99a876c3ca19f48167: full230files2183PASS0skip414.52s/ChromeDEMO12PASS30.0s; both audits0; one Important self-link fixedRED2→GREEN4 and true-cwd npm10 installPASS. No newSQL or production mutation. See dependency-security-b03.md/b03-review.md/evidence/2026-10-02-b03-gates.json. Runtime/schema/provider/UAT gates above remainNO_GO.

## Sequential source integration checkpoint — 2026-10-02

Thirteen development PRs are MERGED at `e5c76b50fefa12925570a7f62dd4480f17025d2d`, each with fresh exact-head full CI230files2183PASS0skip / realPG17 / ChromeDEMO12PASS and actual previewSUCCESS. All fourteen original published heads remain ancestors, with normal merge commits. Final PR #102 still requires its updated-head gates, then main CI and a live-target check; final receipts will be recorded in that PR.

Source main automatic Git deployments are held in vercel.json. Read-only production metadata at `2026-10-02T11:56:02.3962021Z` remains READY aa5d3cb / `dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`; no hosted settings/env/alias/DB/provider writes. Source50 versus last-observed production66 historical SQL IDs remains unreconciled,0 new migrations; original50 still19 LOCAL ONLY pass /31blocked /0not_run. Formal release stays **NO_GO**.

Full per-PR CI/merge table, PR108 preview recovery, B01 conflict resolution, source-hold boundaries, owners and costs: [merge-integration.md](merge-integration.md). Verified raw-log hashes and parents: [integration evidence](evidence/2026-10-02-source-integration.json). Sole B04 review0Critical/0Important/0Minor with all declined behaviors/rulings: [source-merge-review.md](source-merge-review.md). Earlier entries retain their historical results and blockers.
