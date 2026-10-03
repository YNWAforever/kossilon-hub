# Kossilon Hub Implementation Plan — Codex GPT‑6.1 Sol

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本文件是後續執行交接；本次只撰寫計劃，沒有修改產品、資料或部署。

**Goal:** 將已合併但未部署的修復變成有真實業務驗收證據的可用系統，先處理正式站安全版本，再恢復日常、支援、Admin、文件、付款、批次與交件流程。

**Architecture:** 保留現有 TanStack Start／React／PostgreSQL domain services；優先重用已交付T00–T23，不重寫功能。獨立安全hotfix與完整業務release分開；歷史schema使用明確receipt＋physical contracts，而不是修改舊ledger。外部整合以真實回執驗收，UI草稿、本機stub、CI不能冒充供應商成功。

**Tech Stack:** TanStack Start、React19、TypeScript、postgres.js／Neon PG18.6、R2、Vercel與既有Cloudflare maintenance候選；pinned Bun1.4.2；CI Node22／24＋PG17；Vitest／既有Playwright suites。

**Spec:** 來源為 `Kossilon_Audit_Evidence_2026-10-03.zip`。同一交付包的 `Kossilon_Audit_2026-10-03_zhHK.md`、Findings／Tasks／User Cases CSV、Control Inventory，以及repo `docs/audit-remediation/finding-coverage.md`、原50UAT。2026-10-01的F01–F20、T00–T23及50案例保持原ID；本計劃新增R00–R11。

## 執行版摘要與來源

**版本：執行版1.1，2026-10-03（香港）。** 已核對來源ZIP及內部90個manifest項目的SHA256；本次沒有重新稽核live，因此所有現況均以ZIP中的觀察時間為準。Codex啟動後須先做差異核對，不能直接假設舊問題仍存在。

來源ZIP SHA256：`3ba7e64815cf3c3c5a041ee48e699db1cb90e4e11db9da8e36ff8552fcd90885`。

| 首批順序 | 對應任務 | Codex立即可完成的工作 | 本批交付 |
|---|---|---|---|
| 1 | 所有R任務的基線 | 讀AGENTS、比對目前main/live/CI/schema唯讀證據；區分已修／仍存在／不可驗證 | baseline與evidence-delta.md；不改原audit |
| 2 | R01／F21 | 查證正式版本安全狀態；仍受影響才做最小hotfix candidate，使用实际live作base | 獨立PR或「已部署修復」證據；不被整批migration阻塞 |
| 3 | R00／F22 | 重現兩種clean install的Prettier差異，修pin／locks／npm CI覆蓋 | 小型獨立PR及兩種install GREEN |
| 4 | R02／F01、F17 | 實作歷史release相容性判斷；PG18 disposable rehearsal及失敗恢復測試 | 可review的policy／tests／manifest；不執行正式DDL |
| 5 | R03的可先做部分 | 整理owner輸入、隔離staging設定契約、唯讀backlog inventory、restore／native tick驗收步驟 | environment checklist＋blocker owner＋本機fixtures |

首批完成不是整體功能完成。工程修復與正式驗收分開記錄：未備妥provider時，繼續做不依賴provider的contracts、UI狀態、test fixtures及PR，不把整項工作無限期掛起。只有執行不可避開的下一步才需要缺失輸入。

## 任務狀態、PR與驗收規則

執行追蹤表 `Kossilon_Codex_Execution_Tracker_2026-10-03.csv` 為本計劃的續作表；原audit Tasks CSV保持不變。每個R任務分開追蹤 `code_status`、`runtime_status`、`release_status`，另保留task整體狀態。初始化狀態描述「待重新核對」，沒有把本計劃當成新修復證據。

- 可用整體狀態：待開始／進行中／受阻／待驗收／已驗證完成。受阻必附具體input、owner角色、可先做工作和下一步，不能只有「需要credentials」。
- 每個PR對應一個可独立審閱的改動，標明R-ID／F-ID／UC-ID、base/head SHA、before/after行為、commands／exit／pass/fail/skip與rollback。已修且驗證通過的功能只補receipt，不創造無意義code diff。
- 環境層級：LOCAL CONTRACT、LOCAL REAL DB、CI DEMO、STAGING GENUINE、PRODUCTION。下層證據不能自動提升至上層。
- 原50UAT維持原ID及前5欄；append新結果並保留舊local evidence。27個補充UC不能替代原50，表格「能開啟」不能當完整journey PASS。
- SQL／runtime dependency及相容性變更，重跑受影響integration及原gate；純計劃／報告變更只檢查文件與traceability。不要為湊數重跑不相關測試。

**每個驗收receipt至少包含：** task/finding/case ID、UTC時間及環境、exact build SHA、actor role、測試資料版本、steps／command、expected／actual、exit/pass/fail/skip、證據hash、side effects與精確fixture清理結果。文件／付款另含version/hash；batch另含job/preview/item結果；外部整合另含redacted provider reference與實際receipt。

## 外部輸入與未受阻工作

| Owner角色 | 真runtime所需輸入 | Codex毋須等候即可完成 |
|---|---|---|
| Release／DB | staging project/branch/database identity、app role、sole DDL owner、還原目標及freeze窗口 | R02純函數、local PG18 rehearsal、hash／drift／rollback tests、reviewable SQL |
| Auth | 控制中的既有Admin/Manager/Staff/Client帳戶及允許callback origin | 權限矩陣、same-session revocation、negative contracts、invite blocked UI |
| Storage／Scanner／AI | 隔離bucket、provider設定位置、核准合成PDF與owner標註golden corpus | legacy lineage、版本競爭、quarantine及provider failure contracts |
| Finance／業務 | 核准invoice/receipt樣本、原NAR月表、3家公司真實origin判定 | partial/duplicate payment、mapping／year／日期／formula／幂等fixtures |
| WhatsApp owner | sandbox channel與明確核准recipient／發送目的、webhook/CDN政策 | signature/replay／ambiguous mapping／unknown／draft-only／suppression tests |
| Filing owner | 人工提交責任人、reference格式；自動port另需真protocol與receipt查詢規則 | immutable manifest、safe ZIP、manual attestation、return quarantine／timeout contracts |
| Operations／Business | 唯一native scheduler平台、25-user測試窗口及SLO採納 | 指標埋點、load script、cold/warm分類、tick correlation與故障恢復步驟 |

憑證由既有秘密管理機制提供；聊天、PR、evidence不可包含token／connection string／私人客戶文件。不要因provider尚缺就杜撰API或直接改DB假裝邀請／付款／交件成功。

## Global Constraints

- 起始觀察main：`6f0a851a5826030eca903d86f5d7a22b8331a46c`；live：`aa5d3cbddd895bca953b6eef7266ae1cc0b46215`。每個PR／候選發佈重新記錄各artifact的exact SHA，不沿用過時head的PASS。
- Source50 migration ID與live66歷史ID分歧；不能直接 `db:migrate`、reset、重建正式庫、刪歷史、補假migration ID或改已發佈migration bytes。
- 「safe to run application」與「safe to run ordinary migrator」是兩件事。historical release receipt不能自動將舊source history標為current。
- runtime驗收及正式寫入前先有隔離staging、可還原備份、真角色與核准測試資料；本機修復及fixture可先做。使用現有角色，不憑空新增Finance／Reviewer角色。
- `client`／`fixture`／`historical`來源由業務證據決定，不用公司名稱或固定UUID自動分類。queued unknown attempts不得盲目重送。
- Bulk explicit IDs最高5000；worker chunk1–100；NAR preview1–500rows。維持逐項授權、current version、idempotency、partial result與audit。
- Staff invitation仍需tenant-verified provider API；handoff destination仍需verified port。未備妥則保持明示blocked，不製造可成功的假按鈕。
- TanStack security floor：react-start≥1.168.60、start-server-core≥1.169.39；pdfjs-dist≥6.2.108。執行當日重新查官方advisory；不得用audit waiver／降低severity代替修補。
- 保留全部失敗證據；code_verified、LOCAL ONLY、DEMO、staging、production分開。原50UAT19LOCALONLYpass／31blocked不能批量改成PASS。
- 不重寫已發佈git歷史／force push。每個獨立變更正常commit／PR；核實repo的AGENTS指示。
- 本輪只交付執行計劃。後續執行時，先完成可審閱diff、SQL／manifest／rollback與驗收證據，正式migration、部署、外發、邀請／權限變更按當時授權處理。不要提前停下詢問可自行完成的本機工作。

## Review Focus

1. 已過期preview在另一操作者改資料或撤權後執行：應409／逐項拒絕，不能覆蓋；R04/R05/R06。
2. 供應商已收但本機timeout／ACK丟失：應unknown及reconcile，不能自動重送；R07/R08。
3. 歷史metadata有verified但缺object／intent／scan：可見而不可放行；R04。
4. 香港午夜、Filed、不同role/team/origin與微秒cursor：指標與分頁不能漏／跨scope；R06/R10。
5. receipt存在但catalog、payload hash、build或DDL ownership已漂移：應fail closed，同時保留原66歷史ledger；R02/R03。

## 執行順序與檔案責任

R01先重新核實正式是否仍受影響，尚需的安全hotfix可獨立完成；R00 formatter亦可獨立。完整業務release依序R02→R03→R04/R05→R06，再R07/R08/R09/R10，最後R11。這是依賴圖，不要求使用多個agent。

| 範圍 | 現有主要檔案／新檔案 | 責任 |
|---|---|---|
| Dependency/CI | `package.json`, `package-lock.json`, `bun.lock`, `.github/workflows/ci.yml` | 可重现install、security及formatter |
| Schema | `src/features/operations/schema-health.ts`, `schema-catalog.ts`, `scripts/prepare-historical-schema-release.ts` | 分開ledger、physicalDDL、歷史release |
| 新相容性單元 | **新增** `src/features/operations/release-compatibility.ts`及test | 純函數判斷可信release receipt與runtime contracts；不執行DDL |
| Release證據 | `scripts/verify-audit-release.ts`, `docs/audit-remediation/releases/`, `environment-matrix.md` | 指定build的批准manifest／environment／證據 |
| Documents | `src/features/documents/repository.ts`, `server-fns.ts`, `scan-worker.ts`, `analysis-worker.ts` | metadata/bytes/version/scan/review authority |
| Readiness | `src/features/annual-return/readiness.ts`, `readiness-repository.ts`, `readiness-sql.ts` | prepare/approval/transmit同一來源 |
| Admin | `src/features/admin/repository.ts`, `server-fns.ts`, `auth-provider.ts` | 真staff與停用／轉交／provider限制 |
| Bulk/import | `src/features/bulk-operations/{types,repository,worker,server-fns}.ts`, `src/features/nar-import/{mapping,apply,apply-contracts,repository}.ts` | preview／逐項執行／job history／續跑 |
| Handoff | `src/features/annual-return/handoff-*.ts`與components | immutable manifest、人工或真transport、returns |
| UX | `src/routes/{today,work-queue,settings,imports,documents,payments}.tsx`及既有components | scope／下一步／保存狀態／accessible controls |

除R00、R02及驗收工具外，大部分功能已有實作。先重現指定UC；只有真實缺口才改product code。不要為讓測試綠而縮範圍、加skip、延長timeout或改expected使其符合錯誤行為。

## Task 2: R00 — 可重現formatter及npm路徑（F22，0.5–1日）

**Files:** modify package.json、兩份locks、CI；若需guard，create `scripts/check-formatter-parity.mjs`。不批量格式化整庫。

**Interfaces:** 輸入為相同source與兩種clean install；輸出為支援安裝路徑的installed formatter版本與lint exit。guard CLI stdout只印版本／PASS，mismatch exit1。

- [ ] 在兩個乾淨暫存checkout重跑UC27，保存npm安裝得到的Prettier3.9.9／Bun安裝得到的Prettier3.8.3，以及75errors／0errors的RED（3.9.9及3.8.3不是npm/Bun執行器版本）。不要用同一node_modules污染比較。
- [ ] 將formatter精確pin到既有source通過的3.8.3，按pinned Bun1.4.2及受支援npm更新各lock；確認只改formatter相關解析，沒有新漏洞或廣泛dependency churn。
- [ ] CI保留Bun原所有gate；npm portable job安裝後用真正project source執行lint／typecheck，不能只在含package files的暫存資料夾驗安裝。Node22與24均覆蓋。
- [ ] 驗證各clean tree `npm run lint` exit0、`npm run typecheck` exit0；一個既有Fast Refresh warning另記，不為此混入重構。`bun audit --audit-level=low`與`npm audit --audit-level=low`均無當日finding。
- [ ] commit／PR：`fix: align formatter resolution across npm and bun`；附before/after版本與命令，不宣稱產品runtime修好。

## Task 1: R01 — 獨立正式安全修補（F21，1–2日）

**Files:** isolated worktree基於重新查證的實際live SHA（只有live仍為aa5d3cb才以它為base）；package／locks／需要的最小compatibility設定；新security regression test按現有tests佈局；release receipt文檔。参照 `docs/audit-remediation/security-triage.md`、B01/B02/B10既有patch，但逐檔審閱，不能整批cherry-pick main引入schema功能。

**Interfaces:** 消費現有部署schema contract；產出可在舊schema運作、resolved dependencies已patch的独立candidate SHA＋build manifest。不依賴R02 migration。

- [ ] 先核對live是否已獲安全更新：若已修補，保存actual build／alias／security evidence，關閉重複hotfix工作；若仍受影響，才建立獨立candidate。重新查官方advisory，核對兩份lock及實際build解析版本。先寫／取回對應server-function安全regression，在隔離preview重現受影響版本；不要對live送exploit。
- [ ] 實作最小patched dependency組合，覆蓋ReactStart／server-core及PDF.js相關path；保留一般GET/POST server function、Auth callback、SSR routing與build hooks。安全floor是最低值，不要求盲目升全部latest。
- [ ] 在舊schema的隔離PG18副本測核心read-only流程與server functions，outbox／scheduler dispatch維持隔離。該branch跑其完整既有suite＋新security tests，而不是誤套main的2214固定總數。
- [ ] 產出diff、两份audit、build manifest、preview URL／SHA、route smoke、發布步驟與回復方案。若最小patch不能與舊runtime兼容，記錄具體失敗再擴大必要範圍，不能跳過core gates。
- [ ] 待正式發布獲授權後，核對alias實際指向candidate、安全版本仍生效、Auth/core讀取通過。未發生前task最多待驗收。
- [ ] commit／PR：`fix: patch live TanStack server function dependencies`。Rollback應指向已驗證安全compatible build或forward-fix；回到已知漏洞版本須明示風險及決策，不作預設。

## Task 3: R02 — 歷史release相容性政策（F01/F17，2–4日）

**Files:** create release-compatibility.ts及`.test.ts`；modify operations schema catalog／read-only diagnostics、release verifier；沿用historical SQL compiler／rehearsal tests。不要修改普通migrator的拒絕規則。

**Interfaces（本task決定的新契約）:**

```ts
type ReleaseReceipt = {
  id: string;
  payloadSha256: string;
  manifestSha256: string; // 讀取manifest後按批准的canonical算法計算，非假設DB有此column
};
type ApprovedRelease = {
  id: string;
  targetEnvironmentId: string; // 穩定且不含secret的DB/branch/database identity
  payloadSha256: string;
  manifestSha256: string;
  compatibleBuildSha: string;
  expectedHistoricalLedgerSha256: string;
  expectedPostReleaseCatalogSha256: string;
};
type ReleaseCompatibilityInput = {
  buildSha: string;
  targetEnvironmentId: string;
  approved: ApprovedRelease | null; // reviewed, build-bound artifact；不從同一DB任意信任
  receipt: ReleaseReceipt | null;
  historicalLedgerSha256: string;
  postReleaseCatalogSha256: string;
  runtimeContracts: { key: string; matches: boolean }[];
  expectedRuntimeContractKeys: string[]; // reviewed完整key集合；空集合及缺項均不能放行
};
type ReleaseCompatibility = {
  applicationSchemaCompatible: boolean; // 只回答schema相容，不代表Auth/provider/UAT已通過
  ordinaryMigrationAllowed: false;
  historyState: "divergent";
  blockers: string[];
};
function evaluateHistoricalReleaseCompatibility(
  input: ReleaseCompatibilityInput,
): ReleaseCompatibility;
```

此函數只處理歷史release路徑；一般new database沿現有schema-health。可信manifest來自review過、bound-to-build與target environment的artifact，不能因DB自己聲稱receipt成功就信任。`compatibleBuildSha`由CI在build後產生外部release receipt並核實，不要求commit內記錄自己的SHA，避免自我引用。`applicationSchemaCompatible`不等於整個application或release ready；最終GO仍由R11合併Auth、provider、UAT及運作證據判斷。此設計尚未在本輪實作。

- [ ] 写RED：`exact_approved_receipt_allows_app_but_not_migrator`應applicationSchemaCompatible=true且ordinaryMigrationAllowed=false、historyState=divergent；`receipt_only_never_green`對缺catalog/contract仍false。
- [ ] 写RED參數化：payload／manifest／build／歷史ledger／post-release catalog任一hash不符、targetEnvironmentId不符、missing receipt、unknown receipt、單一contract false、空contract清單、缺少expected key、duplicate或unknown key，全部false。保留具體blocker而非exception stack洩漏。
- [ ] 在PG18.6 disposable clone執行既有 `rehearse-historical-schema-release.mjs`；確認所有可歸屬table與未知7table的owner處理；生成**執行後**catalog與runtime contract清單。不能拿執行前guard fingerprint當完成證據。
- [ ] 實作純函數及唯讀collector；覆蓋所有新feature所需欄位、型別、約束、有效indexes及tenant access規則，不只dispatch marker。批准artifact hash要對應实际DDL payload及既有manifest算法。
- [ ] Operations分別顯示「history divergent」「approved release compatible／blocked」「native runtime health」；`verify-audit-release`不要因ledger parser exit0便寫GO。GO須獨立完整gate；默认維持NO_GO。
- [ ] 執行 `npx vitest run src/features/operations/schema-readiness.test.ts src/features/operations/release-compatibility.test.ts scripts/prepare-historical-schema-release.test.ts`；使用獨立TEST_DATABASE_URL；新contract與原migrationguards均PASS。強制中途錯誤rollback、repeat拒絕、兩connection DDL fence均通過。
- [ ] commit／PR：`feat: verify approved historical release compatibility`；附before/after catalog、66ledger原hash不變、receipt hash、rollback。正式migration仍未授權／未執行。

## Task 4: R03 — 真staging、schema演練、scheduler與積壓（2–4日，外部依賴）

**Files:** environment-matrix、historical-release-runbook、scheduler-runbook、data-origin-runbook及evidence；必要修改 `src/server/maintenance-trigger.ts`、`maintenance-trigger-runtime.ts`及 `src/server/cron-wiring.test.ts`，只改重現缺口。

**Interfaces:** 消費R02 compatible build／manifest；產出staging target identity、restore receipt、唯一scheduler owner、三次native tick correlation及backlog逐項review清單，供所有runtime UC使用。

- [ ] 列出需要的owner決策：Neon branch／app DB role／logical owner／sole DDL owner與freeze、Vercel或Cloudflare唯一trigger、R2隔離bucket、Auth回調origin、sandbox recipients。不能因project技術owner=neondb_owner就推定業務owner已批准。
- [ ] 在隔離provider clone做實際backup→restore→row-count／key relations／hash驗證；證明復原可用再談migration。不得把local synthetic restore當hosted restore。
- [ ] 應用reviewed package；核對R02receipt、全部contracts、66ledger未變。普通migrator仍保持拒絕divergent history。
- [ ] staging用合成client/fixture/historical三组，dispatch先关闭；覆核目前4pending及14analysis如何移交。對production3家公司先產出只讀inventory讓業務分類，不自動UPDATE。
- [ ] 啟用**一個**經批准的staging native scheduler；等三次真5分鐘tick，驗slot去重／lease／fencing／partial pass failure／queue progression。手動HTTP呼叫及built hook存在不計真tick。
- [ ] 驗 `npx vitest run src/server/maintenance-trigger.test.ts src/server/cron-wiring.test.ts src/features/operations/repository.integration.test.ts` 加actual provider receipts。UI10分鐘freshness門檻與真tick對得上。
- [ ] 將環境identity、receipt與unknown pending處置存evidence；若owner/provider仍缺，標受阻，但先完成所有本機checklist／contracts，不空等。

## Task 5: R04 — 文件、Portal、scan、付款、readiness（3–5日）

**Files:** Documents／Portal／Payments／annual-return既有模組；tests包括 `src/features/documents/{repository.integration,server-fns,scan-worker,analysis-worker}.test.ts`、`src/features/annual-return/readiness.integration.test.ts`、`src/routes/-payments.interaction.test.tsx`。保留現有payment domain services，先用`rg`定位其實際module，不另建第二套計算。

**Interfaces:** 消費R03環境；R04本機fixtures可先做，fresh-role runtime驗收消費R05提供的核准身份（可先用existing controlled Staff）；輸出current document/version/SHA／clean scanner verdict／review audit／payment credit／ReadinessSnapshot。沿用 `ReadinessSnapshot` 的readyToPrepare／readyForApproval／readyToTransmit，不以UI自行推算。

- [ ] 原樣先跑UC03/04/05；證明main已修canonical UUID／LEFT lineage。若PASS只補genuine evidence，不重寫。
- [ ] 製作受控legacy案例：metadata/version存在、intent缺少、object missing/unknown/exists三類。metadata皆可見；只有查明object、checksum／scan後逐筆approved recovery才增加intent；不回填假的clean或reviewedAt。
- [ ] UC13真R2上載／下載checksum與scanner roundtrip；V1→V2後舊approve必409或拒絕，bytes可見權限同list/by-ID。損毀、空檔、過大、加密／不支援格式保持可處理錯誤與隔離。
- [ ] UC21用owner標註corpus驗OCR/AI的page/span來源、錯公司/年度、人員適用性、文件中的不可信指令；AI只能建議，不直接verified／放行。golden預期由業務確認，不以模型自己當truth。
- [ ] UC14：invoice1800、600+1200、duplicate、stale proof V2、並行approve、reasoned return；最終credit只1800，partial時仍欠款，audit與credit同transaction。
- [ ] UC01付款/parties/scan/critical finding任一缺失時Today、case、queue、package共用readiness。文件verified13/14不得當做真scan證據。
- [ ] 只對失敗補最小RED→GREEN；跑上述focused suite＋typecheck＋lint。保存真provider sample的不可識別reference/hash；不保存credentials、完整客戶身份文件。
- [ ] PR或驗收receipt獨立完成；逐筆14件production恢復建議仍需review，不自動修復正式資料。

## Task 6: R05 — 真Auth、Admin與租戶隔離（2–3日）

**Files:** `src/features/admin/{repository,server-fns,auth-provider}.ts`、auth／documents authority；tests `admin/repository.integration.test.ts`、`admin/server-fns.test.ts`、`documents/authorization.test.ts`、`documents/server-fns.test.ts`。

**Interfaces:** 消費R03已核准tenant／origin／controlled accounts；產出Admin/Manager/Staff/Client session矩陣及same-session撤權證據。沿用目前actor模型；不將通訊錄email當immutable Auth ID。

- [ ] Fresh magic link／Google返回原case、expired link重試、未知身份拒絕；重用existing session只能證明讀取，不算此項PASS。
- [ ] UC15／UC23：2公司、2teams、owner／assigned reviewer、ClientA/B；測list/search/by-ID/download/review/bulk所有入口。每個拒絕同時檢查沒有回private bytes／無資料寫入。
- [ ] 先轉交剩餘工作，再停用Staff；同session後端即拒絕；另一Admin並行停用不得破壞既有兩Admin invariant。role/team變更使舊preview失效。
- [ ] Invite保留blocked直到tenant-verified API／權限／recipient已確認；不要輸入假management token或用直改資料庫假裝Auth邀請。
- [ ] 對真失敗加focused regression、重跑原role matrix；再存fresh-provider結果。既有CI測試不可替代此receipt。
- [ ] commit／PR僅包含必要auth fix及evidence。暫未提供帳戶時交付精確matrix＋fixture/test工作，provider UC保持受阻。

## Task 7: R06 — Today／Work Queue／月表／批次維護（3–5日）

**Files:** `src/features/bulk-operations/{types,repository,worker,server-fns}.ts`及integration tests；NAR apply-contracts／mapping／apply.integration；Today／dashboard／work-view-repository及list components。

**Interfaces:** 消費真actor/current readiness；沿用selection `{mode:'explicit_ids',ids}`或`{mode:'filtered_snapshot',snapshotId,excludedIds}`、execute `{previewId,idempotencyKey}`。輸出可持久重開job、per-item結果、audit/失敗匯出；export要走同scope，不另寫可繞過授權SQL。

- [ ] UC02/12先比較同scope數字、Filed排除、香港午夜、姓名/team/workload與business blocker。count單位顯式為案件／文件／工作項目；0mine不可暗示全隊0。
- [ ] UC16：101筆，途中version變更、撤權各一筆；double-submit、worker中斷重啟；成功項不再做，失敗可解釋，unknown不當safe retry。取消只停止尚未執行項，UI必說明。
- [ ] UC18：201/400/401、同timestamp不同µs、search beyond firstpage、actor切換；snapshot全選含排除，不悄悄變成當前篩選新結果。全選數、可操作數、不能操作原因都可核對。
- [ ] 六類日常動作逐項驗收：client maintenance、document assignment、document return draft、document list export、follow-up draft、payment list export；draft不得外發，export不漏／不跨scope，Spreadsheet cells防formula injection按現有export策略驗證。
- [ ] UC17用核准原XLSX：年/月sheet、1900/2100邊界、invalid日期、重複CR/BR、公式/空白/錯誤儲存格、year/due差異；先3行再100行，不直接全量apply。預設historical且不send；activeCurrentYear須明確review。
- [ ] 執行 `npx vitest run src/features/bulk-operations/repository.integration.test.ts src/features/bulk-operations/actions.integration.test.ts src/features/nar-import/apply.integration.test.ts`；不放寬100-row timeout掩蓋性能。UC16/17再跑真staging native worker。
- [ ] 每個必要fix獨立commit；驗收保存job ID／selection hash／各結果數／before-after hash／cleanup exact IDs。首批正式bulk為另外批准步驟。

## Task 8: R07 — WhatsApp閉環（2–4日）

**Files:** 既有whatsapp repository／server-fns／intake-repository／media／outbox handlers；tests `src/features/whatsapp/intake-repository.integration.test.ts`及既有message/outbox suites。

**Interfaces:** R04提供clean current attachment；R05提供actor；provider port提供真inbound ID、send attempt／receipt。設定存在≠service health≠send approval。

- [ ] 四項WOZTELL bindings由owner在隔離provider設定；確認channel與核准收件人、CDN allow policy、webhook signature。本機contract先測missing／invalid／expired signature、重播，不觸發真訊息。
- [ ] UC22：同電話多company/case必manual mapping；media以case scope進quarantine，掃描前不可轉正式可用文件。
- [ ] current approved preview與執行時recipient/template/session重新核對；版本或授權改變則拒絕。follow-up bulk只建draft。
- [ ] 只有具體sandbox收件人及發送目的獲授權才發真測試訊息；sent／delivered／failed／unknown各有真receipt。simulate ACK loss後先query/reconcile，不重派。
- [ ] fixture/historical三origin及舊pending隔離測試通過後才擬正式enable清單。保存redacted provider ID與timestamp，不儲存token/私人電話。
- [ ] 若無provider，local contracts及review完畢可交付；task仍受阻，不用stub當PASS。

## Task 9: R08 — 人工交件／回條與外部port（2–4日）

**Files:** `handoff-repository.ts`、`handoff-server-fns.ts`、`handoff-destination.ts`、`handoff.integration.test.ts`、`handoff-destination.test.ts`、`components/case-handoff.interaction.test.tsx`。

**Interfaces:** 消費R04的current manifest／approvedPayload；保留已有HandoffResult accepted/refused/unknown/failed契約。manual attestation與provider receipt分開，不能以人工reference假裝API delivered。

- [ ] UC19：approved manifest後更換文件V2，舊export／submit拒絕；重新approval只可取被批准的真bytes與checksum。
- [ ] 驗ZIP entry count／filename path安全／大小限制／串流錯誤／same-origin授權；平台實際下載過程測timeout及中途斷線。
- [ ] 先驗收可完成的manual path：export→人工提交記錄reference／operator／時間→上載回條quarantine→review→reconcile→關案；沒有receipt不能以export成功標已提交。
- [ ] 外部connector只有protocol/endpoint/auth/rights/receipt查詢契約已確認才實作；沿verified port工廠，不猜公司的內部API。timeout after accept應unknown、immutable attempt，重試先查provider。
- [ ] 驗返回重播／拒絕／cancelled history／未知active attempt及race；actual PostgreSQL與平台streaming皆通過才驗收。無目的地時人工路徑可獨立PASS，自動port保持blocked。
- [ ] commit必要修復及receipt；rollback不能抹掉外部已收事實或重新派同件。

## Task 10: R09 — 公司成立／变更、Settings與手機UX（2–3日）

**Files:** 既有incorporation／corporate-changes模組與workflow/server-fns/repository tests；`src/routes/settings.tsx`、`-settings-save.interaction.test.tsx`、`-settings-templates.test.tsx`；template snapshots與sidebar。

**Interfaces:** 沿existing workflow status contracts、template revision與case snapshot，不新創狀態。使用既有role nav，保留returns/filter狀態。

- [ ] 將本輪UC09/UC10的「開表格」與原FLOW-09/10/11/12完整測試分開：staging新client→case；incorporation intake→文件／付款→既有合法completion；name/share/officer/address四變更與cancel／重播；recurring service及SCR更新。只用controlled records。
- [ ] Share transfer以兩connection測相同holding並發及超額shares拒絕；重複completion不重扣／重加；cancel依既有domain允許邊界處理，不能造成share register與request不一致。
- [ ] UC11：正式不可讀mock20cases；scope使用數未量得應不顯示或明示unknown，不默示真0。範本改revision、舊editor409可保留draft並reload；既有case snapshot不被新template覆蓋。
- [ ] UC25：390與1280viewport；Tab/ShiftTab/Escape、dialog focus return、無label controls補accessible name、44px主要touch、錯誤／empty／loading／保存狀態與next action清楚。所有中英文用詞表一致，繁中為主要營運介面。
- [ ] 不將env var名字放成同事的主要操作指引；worker/provider detail放Admin diagnostics；Staff看到原因、owner及下一步。
- [ ] 跑incorporation/corporate workflow＋repository、Settings interaction suites及既有browser tests；再用真角色做日常旅程。保存viewport、keyboard結果及screenshot；不以DEMO12pass取代。
- [ ] 按subsystem小PR交付必要缺口；禁止為美化重新設計整個操作順序而漏掉既有功能。

## Task 11: R10 — 效能與營運可恢復性（2–3日）

**Files:** `scripts/benchmark-audit-queries.ts`、performance runbook、work-view/document read SQL、SLA calendar及existing contracts、Ops health/telemetry。先measure，沒有實測瓶頸不新增cache/index／改DB全域設定。

**Interfaces:** 輸入R03等效platform/runtime/region/PG18與R06真scope workloads；輸出逐endpoint sample CSV、p50/p95/p99/error、query plan／payload／render、cold/warm標記、queue lag。UI count、list及commands繼續同authority與readiness。

- [ ] 與owner採納UC24門檻；如未採納，仍先量度並標建議目標，不能自行宣稱SLO PASS。
- [ ] 10k cases／50k docs、代表性versions/officers、25users：5分鐘ramp＋15分鐘穩定；cold與warm各記樣本、硬件、pool大小、zone、runtime版本，隔離provider成本／外發。
- [ ] 先分HTTP／DB RTT／SQL／serialization／render／provider；對照Web iad1與DB Singapore，僅在RTT證據成立時提region方案。不能把移region當無風險小改。
- [ ] 保留current 50/100 bounded page及full-scope counters；EXPLAIN ANALYZE只在staging；驗index使用、JIT transaction-local恢复、µs cursor、取消請求與actor cache隔離。
- [ ] SLA100及NAR100依原fixture量度，不能只報「提速」無before/after同環境。PDF worker/parser需實測navigation network不提早載入；1.26MB產物不是已證明首頁下載量。
- [ ] UC20真native三tick、一pass故障、recover、queue backlog／unknown查證；UI顯示correlation與last-success／last-attempt，不用config-present作healthy。
- [ ] 保存負載清理精確ID與public counts未受影響；若對範圍有performance fix，再focused RED/GREEN與原安全／資料一致性gate。不要用降低正確性換速度。

## Task 12: R11 — 分批發佈、原50 UAT與交接（1–2日）

**Files:** 原 `uat-results.csv`（保留原前5欄與IDs）、release checklist、task ledger、new exact-head evidence/manifest／deployment receipts。新增runtime結果欄或append evidence，不能覆蓋歷史local結果。

**Interfaces:** 收集R00–R10結果；輸出release decision={NO_GO|APPROVED_LIMITED_SCOPE|GO}及明確feature scope、owner、SHA、hash／rollback。任何真provider仍blocked時不能全系統GO；limited scope不得顯示blocked功能已完成。

- [ ] 執行原50UAT逐項核對：ACTUAL role、資料版本、環境、steps、actual與expected、case/doc/job/provider IDs、timestamp、cleanup。新UC01–27是補充，不縮減原50。
- [ ] exact候選head跑原CI所有gate：兩份audit、typecheck、lint、真PGtest、build、dev-import保護、compiled maintenance hook、DEMO browser與另列genuine staging UAT。最新純文件commit也要有自己的必要CI證據。
- [ ] 在發佈前做一次全branch review與rollback rehearsal：舊／新app對schema相容、停止新queue／保留unknown、恢復時間與資料損失窗口；資料已commit後不盲目down-migrate。
- [ ] 準備具體reviewable release包：migration SQL＋manifest hash、DB fingerprint、backup/restore receipt、owner/freeze、candidate SHA／runtime、native scheduler owner、外發收件範圍、已通過／未通過功能與rollback。這是需要批准時的最後一步。
- [ ] 批准後按先schema／compatible app／disabled integrations smoke／少量controlled cases／逐功能activation順序；不要一次開4pending外發、14analysis及所有bulk。
- [ ] 發佈後以Vercel alias核對web SHA、以platform receipt核對scheduler SHA，再與schema release compatibility清單比對；兩個artifact可有不同SHA，但必須可追溯至同一批准release與shared job contract。加上DB receipt＋Operations／三native tick＋core UAT核對，觀察錯誤率與queue。任何證據不符停止擴大，依已演練方案回復。
- [ ] 完成營運runbook：同事每日Today／blocker／收據與support escalations、Ops unknown/retry準則、Admin離職交接、批次job結果、template改版與故障owner。最後狀態只在target環境有證據時寫「已驗證完成」。

## 可直接交給 Codex GPT‑6.1 Sol 的起始指令

```text
請讀本Implementation Plan、2026-10-03稽核報告、Findings/Tasks/UC CSV，以及repo AGENTS與docs/audit-remediation。
先核對最新main/live SHA及工作樹，保留原F01–F20、T00–T23與50UAT。
依R00–R11逐task執行；最高優先先核對R01並完成尚需的獨立安全candidate，R00可獨立修。
大量domain功能已在main：先重現及驗收，只有失敗才改code，不重寫整批功能。
R02要補明確historical-release compatibility政策，禁止偽造migration IDs或放寬ordinary migrator。
自主完成本機code、focused tests、reviewable PR、SQL/manifest/rollback、staging test fixtures。
外部帳戶／provider缺少時，完成未受阻工作並清楚列owner/input，不製造receipt或把stub當實際成功。
涉及正式migration／部署／發送／邀請／權限寫入，按當時授權，先備齊具體可審閱結果再處理批准。
每次報告exact SHA、tests實際數目、環境及限制；保留fail/blocked，不用CI綠取代business UAT。
```

## 自我審核

- 本計劃覆蓋16入口、原20findings＋2新增、日常／support／Admin／新功能／performance／bulk與原50UAT。
- 新介面只在R02明確定義；其他task沿現有domain contract，避免再造平行邏輯。
- 五項Review Focus各自有task內具體測試。精確runtime dependency、roles、schema和版本界線保留。
- Pending估算不是完成承諾；此文件未聲稱已建立staging、登入新身份、修復production或發佈。
