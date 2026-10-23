# Kossilon CoSec OS — 本機驗收續批

本輪新增兩組可 review 回歸：**R26.4 的 500 列真實隔離 SQL 旅程**，以及 **R22 的鍵盤／角色／唯讀 reload／reflow demo 旅程**。必要本機檢查通過；產品 runtime source 維持前批內容。**Release gate 仍為 NO_GO，沒有原生 authenticated 或正式可用結論。**

候選 source commit：`d632570839640cc07c83aa76b3b51310038cf245`，branch `codex/cosec-20261023`。本輪從乾淨 `717ee08cfdfb6dc819d2105d8152b153207c9e03` 繼續，保留前批交付；workspace 為 `C:/Users/laich/Documents/kossilon-hub/cosec-20261023`，origin `https://github.com/YNWAforever/kossilon-hub.git`。main 在本輪末重新唯讀核對仍為 `1c57a67213af72bff8d776694e6ed8c986b921db`。production 的 `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` 僅為提供的歷史值，本輪未接觸或重新核實 production。

| 本輪成果 | 實際證據及限制 |
| --- | --- |
| R26.4／F09／UC181/182 | 500 個合成 normalized source rows；真實 staging/preview/jobs/domain SQL；20 欠 fee，37 commits 後合成中斷、取消443、重新review463、分批100/100/100/100/63、並發冪等、Staff／foreign-job 拒絕；獨立連線回讀500個不同case/payment/work/journal；付款仍pending、沒有因來源日期變paid。見 [R26.4-500](R26.4-500.md)、[實際事件](db-verify/events-final.jsonl)、[回讀摘要](db-readback-summary.json)。不是 XLSX binary／HTTP／原生Auth驗收。 |
| R22／UC117/118/196/197 | 兩個起始viewport的真實本機Edge demo測試通過，每個涵蓋Admin/Staff；Tab/Enter/Escape、drawer focus trap/return、客戶demo空態、既有fallback→案件→唯讀reload→返回、Admin唯讀／Staff直接管理頁拒絕。案件階段640 CSS px。見 [R22-runtime](R22-runtime.md)、[results](browser/final/results.json)。不是actual200%zoom、完整390全程、client-record return、screen reader或nativeAuth。 |
| 證據及保留 | [驗收CSV](acceptance-results.csv) 保留原35 F、15 R、100 UC、34 LA，共184列；original row JSON、歷史結果及native結果逐欄相同。只追加本輪scoped local證據。native仍70 BLOCKED／114 NOT_RUN，0 pass。前批[DELIVERY](../cosec-20261023-79d324f0/DELIVERY.md)及其400檔manifest不被改寫。 |

實際改動只有四個 source/test/config 檔：新增 `src/features/nar-import/scale.integration.test.ts`、`e2e/continuation-reflow.spec.ts`；DB registry 及 Playwright local testMatch 各加一項。沒有重寫已有正確的產品修補、改依賴、正式schema或帳戶。`source.patch` 與 `source-candidate.json` 提供完整 diff／檔案指紋／Git blob。

| 本輪實際檢查 | 結果 | Log |
| --- | --- | --- |
| `npm test -- --project unit --maxWorkers 2` | 265 files／2464 passed、0 failed、0 skipped | `unit-verified.txt` |
| DB project，僅新增 scale integration file | 1 passed；23.87秒scenario；不是前批146項DB整套重跑 | `db-verify/db-500-final.txt` |
| Playwright local，僅新增 continuation-reflow file | 2 passed、0 skipped；Edge155.0.4283.62；不是前批12項browser整套重跑 | `browser-04.txt`、`browser/final/` |
| App typecheck、獨立 e2e TypeScript | exit0；DB事件writer最後改動後再typecheck | `typecheck-events-final.txt`、`e2e-typecheck-final.txt` |
| Full lint＋最後DB檔lint | 0 errors；full lint有1個既有Fast Refresh warning，最後檔0 warning | `lint-final.txt`、`lint-events-final.txt` |
| `npm run build` | exit0，local cloudflare-module；419個build檔指紋；沒有部署 | `build-final.txt`、`build-artifact-manifest.json` |

測試在 `717ee08…` 加本輪 dirty 候選上執行，後以普通本機 commit 固定；沒有把舊2076 unit或9項4pass/5fail當新結果。整套unit／build後只改DB project的事件writer，該檔不進unit或產品bundle，已另跑真DB、typecheck、lint。其餘候選內容及最終指紋相同，產品runtime source與 `e8ecf3fad979adc4321a58eb64a90d0927e175de` 相同。沒有把 commit metadata 當重跑證據。

失敗紀錄未刪除：unit首輪TEMP rename EPERM後改獨立cache，整套再有3個watcher測試因TEMP落在node_modules而被預設忽略；移往獨立非node_modules目錄，原斷言先3/3、再完整2464通過。DB首輪缺SLA前置資料而拒絕，補本輪精確immutable foundation後通過；成功stdout被Vitest隱藏，故另建verify run用exclusive JSONL重跑。browser未啟動及兩輪authored斷言／同步問題詳見R22紀錄，沒有將其寫成產品缺陷或移除功能期望。

每個 DB client／migration／fixture／cleanup 前均核對本輪container/image/labels/port/mount/path，並比較TCP與容器內server system ID。兩個owned tmpfs containers都已按完整ID移除，fixtures先回讀歸零；僅自己的immutable SLA foundation留到整個container移除，沒有bypass trigger。credentials已刪除、demo port已釋放。見 `cleanup-final.json`。沒有動其他worktree／container或啟停Docker daemon。

未完成及下一步見 [blockers](blockers.md)：500列混合實際檔案、同版原生Auth/HTTP/DB/reload完整旅程、多角色／裝置／actual zoom、provider/scanner/storage、原生ticks、代表性p95及release/rollback仍待相應隔離身份與存取。使用者已選先完成本機驗收；本輪沒有push、merge、deploy、正式migration／資料／權限、真實訊息／付款／交件或付費服務。

候選資料：[release-candidate.json](release-candidate.json)；原編號驗收：[acceptance-results.csv](acceptance-results.csv)；檔案完整性：[evidence-manifest.json](evidence-manifest.json)。
