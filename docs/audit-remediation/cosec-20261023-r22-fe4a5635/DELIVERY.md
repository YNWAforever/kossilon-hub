# Kossilon — R22 本機瀏覽器續驗

本輪補齊R22的 **全程固定390×844** 及 **真正200%瀏覽器page zoom** 本機demo缺口；Admin／Staff均走完可用的唯讀路徑，原生Auth及完整業務接受仍blocked，release gate仍 **NO_GO**。

候選source：`2b25cacf4af6a1c2fc529e4b585000fe40bab40d`，branch `codex/cosec-20261023`。開始HEAD `09d57c13761f73ae55064a59936537dc74d0738a`，工作樹乾淨；已核對AGENTS／RTK、origin及保留原有worktrees。開始及交付前遠端main均為 `1c57a67213af72bff8d776694e6ed8c986b921db`；提供的production SHA只作歷史輸入，未存取正式站。

| 本輪驗收 | 真結果及限制 |
| --- | --- |
| 新browser矩陣 | **3 tests passed**：full390、desktop100、desktop200，各含Admin／Staff，共48個checkpoint。全程不變寬度；desktop原生視窗固定1304×992，100%內容1280×900／DPR1，200%內容640×450／DPR2。每個checkpoint的CDP page zoom分別1／2，pinch scale1、CSS zoom1／transform none。見 `runtime-summary.json`、`browser-native-capture.txt` |
| 唯讀旅程 | Demo登入→總覽→客戶不可用邊界→年報空搜尋→Delta Bloom唯一案件→核對owner／文件阻礙／pending付款→readonly阻擋→reload不變→返回→Admin唯讀用戶管理／Staff直接路由拒絕→登出。沒有編造client records，這不是client-record roundtrip或持久化寫入 |
| 鍵盤與幾何 | 真Tab／Shift+Tab／Enter／Escape；逐一遍歷drawer tab stops並wrap、Escape焦點返回、focus-specific cue；關鍵欄位／動作檢查內層裁切、滾動前hidden／clip、文字寬高及中心hit。空態／禁止操作有明確斷言 |
| 原有回歸 | **2 tests passed**：原mobile390／desktop1280入口及640 reflow案例，共用helper補強後重跑；它們仍是reflow模擬，沒有重新命名成zoom驗收。見 `browser-reflow-complete.txt` |
| 圖像證據 | 最後三組有60張原生CDP viewport／fullpage圖，viewport的PNG尺寸有斷言。Playwright在真正200%的fullPage crop問題已獨立重現，舊裁切圖完整保留；改為native surface及按zoom換算的fullpage捕捉。人工看過最後390與200%的Admin case viewport，以及200%全頁；這不是全站視覺或screen reader認證 |

本輪沒有產品修補：只新增專用browser test／config，抽出並補強既有共用鍵盤helper，原測試旅程斷言保留。四個來源檔案及diff見 `source-candidate.json`／`source.patch`。新矩陣最後使用 `source-freeze-capture.json` 的內容；兩組reflow最後使用相同helper與原spec的內容，與capture前freeze逐檔比對。普通本機commit只固定實際驗過的bytes，沒有push。

| 本輪其他檢查 | 結果 |
| --- | --- |
| `npm run typecheck` | exit0；project config不含e2e，另跑下列明確e2e檢查 |
| e2e／專用config TypeScript檢查 | exit0，最後log `e2e-typecheck-capture.txt` |
| `npm run lint` | exit0、0 errors／1既有Fast Refresh warning；最後source變動後changed-path lint亦exit0，`lint-capture.txt` |
| Unit／DB／build | **本輪未重跑**。src／package／鎖檔／產品build設定與開始候選一致；前批2470 unit、2 SQL、build只保留前批版本的結果，不套成新測試數字 |
| 歷史完整性 | 原三批manifest的399／108／45個entries hash均未變。所有原始失敗、source snapshots、trace、截圖及歷史結果保留 |

[驗收CSV](acceptance-results.csv)保留35 F、15 R、100 UC、34 LA，共184列及完整original_row_json，只追加R22／F19／UC117、118、196、197的本機scope。Native仍70 BLOCKED／114 NOT_RUN／0 pass。首次fixture tracing失敗、lint命名錯誤、disabled pointer-events測量假陰性及截圖crop問題均在 [方法及檢視](R22-method-and-review.md) 分開歸因，沒有當成產品RED/GREEN。

測試子程序使用env白名單，無DB／native Auth／provider設定；先證明5180空閒，禁止重用既有服務。每組使用新profile；瀏覽器禁止外部及HTTP寫入請求。三組最後均0 forbidden request／0 page error。`cleanup-final.json` 確認5180無監聽、本輪瀏覽器已退出；新profile只留在ignored自有run paths，未冒稱已刪除。沒有建立DB client、migration、fixture或外部業務寫入。

下一步及邊界見 [blockers](blockers.md)：同版原生隔離Auth／HTTP／DB／reload、client records、多角色、screen reader／實體裝置／Safari、native ticks、provider／scanner／storage、代表性p95及backup／restore／release仍需各自前提。本輪沒有push、merge、deploy、開main自動部署、正式資料／帳戶／權限、真訊息、付款、交件或付費服務。

交付：[候選資料](release-candidate.json) · [runtime摘要](runtime-summary.json) · [證據manifest](evidence-manifest.json) · [唯讀交付檢查](verify-delivery.ps1)。
