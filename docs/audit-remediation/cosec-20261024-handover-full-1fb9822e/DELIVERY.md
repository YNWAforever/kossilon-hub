# UC186：合法候選前置修補；完整交接仍未完成

本輪從交付 `7a70e3be143cf771b6693f4ec2bb491817f74ca9`／候選 `4e5b4532091d125d79ca19244a0699f26832166a` 續做；同一root／branch／remote、起始clean、沒有後續交付。**這是部分交付，未完成使用者要求的完整owner／reviewer跨業務轉交及停用並發保護。** 普通本機source候選 `209aef6c78fe1ded6ad3a68eba4eaa9bd7304243`，見 [release-candidate.json](release-candidate.json)，release gate為NO_GO。

## 重現、修補與仍缺部分

實際focus RED為2 failed／13 passed：Admin沒有「預覽責任交接」command入口；沒有required skill的工作把合法同隊Staff也排除。`focus-red.txt`保留完整失敗，未更改期望迎合產品。

本輪產品diff只有work-items的4檔：`assignment.ts`、`types.ts`、`repository.ts`、`assignment.test.ts`。根因有兩層：SQL先因null技能短路／inner join排除無技能資料列，ranker亦強制技能存在。現在null表示無技能要求，SQL用LEFT JOIN回傳合法profile，ranker以0技能分作正常負荷排序。指定技能時仍需精確active技能；active／available、role／team、owner與reviewer分工仍須通過。審查發現的empty-string舊有拒絕已保留。沒有改staff lifecycle、parent case、migration、Auth或正式資料。

**缺command的UI RED仍未解決**。其原始測試完整封存在 `handover-ui-red.test.tsx.snapshot`；新SQL probe在 `handover-execution.test.ts.snapshot`，狀態NOT_RUN。歸檔只撤回本輪新增、尚未實作的active-suite候選，保留原oracle及hash，不新增skip／反轉assertion。最後unit中的Admin6項是舊有預覽／guard regression，不能當成完整交接通過。

本輪未重現SQL race：四次實際provision gate均低於3GiB（2,711,203,840／3,067,314,176／3,073,052,672／2,599,325,696 bytes），在建立container前停止。沒有因靜態可能race而先改鎖；完整交接command、兩個先後次序的新案／指派競爭、正向audit、回應遺失重試及獨立readback均仍缺。詳見 [blockers.md](blockers.md)。

## 本輪實際結果、歷史與NOT_RUN

| 層級 | 本輪結果 | 限制／證據 |
| --- | --- | --- |
| Focus重現 | 2 failed／13 passed | `focus-red.*`；兩個缺陷分開保留，missing-command仍未解決 |
| 最終相關unit/component | **36 passed／8 files** | `targeted-accepted.*`；包括assignment8項，不與8相加；其餘為現有role／Admin／Auth／DB registry regression，mock層 |
| Typecheck | exit0 | `typecheck-accepted.*`，最終4-file候選 |
| Full lint | exit0 | `lint-accepted.*`；既有work-queue Fast Refresh warning保留。首次2個test格式error保存在`lint-current.*`後修妥 |
| Build | **NOT_RUN_RESOURCE** | `resource-checks.jsonl`：2,163,892,224 bytes <3GiB，沒有啟動build。舊build不能套到新候選 |
| 真SQL／DB recommendation／完整轉交／並發 | **NOT_RUN／BLOCKED_RESOURCE** | `db/provision-*.jsonl`，沒有app client／fixture／migration；不能稱SQL RED或PASS |
| Full unit／browser／native Auth/HTTP/RLS／provider | **NOT_RUN本輪；原生仍BLOCKED** | 歷史2076／2768、上批28 unit及1 SQL均不是本輪結果，也不能拼成完整端到端 |

本輪runtime實際範圍只有mock／pure unit/component，沒有登入、API mutation、資料庫、browser reload或原生權限驗收。Static review支持nullable SQL的語義；SQL路徑尚需真實讀回驗證，不能稱接手人已完成業務操作。

## 隔離、版本與原證據

Run為 `cosec-20261024-handover-full-1fb9822e`。沒有建立本輪SQL target；只讀context／image及exact run-label inventory，`owned-inventory.json`確認container0、cache不存在，因此沒有server systemID可宣稱已驗證，也沒有cleanup。沒有停止其他process／container以騰RAM。普通sandbox的CIM讀取失敗另存收據；正常escalation的唯讀本輪process inspection確認remaining0，沒有刪除檔案或殺process。

512MiB／1CPU／1GiB tmpfs、fixed installed image、無shared mount、loopback及RAM門檻全部保留。未達target identity gate便不import真DB client；沒有正式seed、改scan、造tick、訊息、付款、交件或付費服務操作。沒有push／merge／deploy或改寫git歷史。

來源freeze為669檔，`source-accepted-before.json`與`source-post-checks.json`逐項相等；候選Git blobs亦須相等，見`source-candidate.json`及verification report。RED在base產品＋新增測試時執行；其前沒有atomic全source manifest，版本由已核對clean起點及已記錄的測試增量定位，不冒稱RED在最後SHA執行。之後擴充同一null-skill regression檢查雙向分工、inactive／unavailable／wrong-role／wrong-team拒絕與0技能分。

19批／2,655個原manifested files重新核hash；原184列（35F／15R／100UC／34LA）、original_row_json、歷史失敗／關聯及native欄位不改。新CSV只在UC186附加本輪部分結果，native仍70BLOCKED／114NOT_RUN／0PASS。遠端main重新唯讀核對仍 `1c57a67213af72bff8d776694e6ed8c986b921db`；本機main是舊祖先、落後256commits，沒有移動refs。舊production未存取。

回復這個候選可用普通新commit revert本批source commit；保留證據，不需要DB回復。新SHA或不同target須重新驗證；這批沒有可宣稱正式可用的artifact。

## 距離員工完成日常工作，仍欠的必要關卡

1. **本機UC186業務閉環**：完成合法owner／reviewer三業務parent＋work轉交、atomic拒絕、同operation重試、audit／readback；實際重現並修新案／指派對停用的兩種並發次序。不是只等原生環境。
2. **新候選必要驗證**：RAM達標後先跑真SQL推薦／指派／轉交及build；完成源碼與schema／依賴相容核對。現候選只通過unit／type／lint。
3. **同版真身份與權限**：native Auth/session、Admin／Manager／Staff／Client、跨team、HTTP／app-role/RLS及撤權後舊session／cache拒絕。
4. **一條完整員工旅程**：Today下一事→正確案件→安全文件／付款／blocker→授權操作→API、獨立資料回讀、返回／reload一致；含空態、錯誤、重複／並發及取消。現有分段PASS不能代替。
5. **營運及必要外部步驟**：核准calendar、真scheduler freshness、DB／依賴安全、backup＋storage恢復、可及性／效能；真scan及日常所需provider／filing receipt須受控驗收或明確人工接手。尚未接通者保留blocked，不能稱送達／交件成功。

續做仍是原UC186，不另猜編號。完整原生環境、角色／資料、使用者流程、待批用量及cleanup列在 [NATIVE-PLAN.md](NATIVE-PLAN.md)，只準備，未執行。
