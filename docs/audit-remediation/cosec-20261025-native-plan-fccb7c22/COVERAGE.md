# 剩餘核心覆蓋：只審閱既有證據

基線交付531887ac／source4d63818。原184列逐byte保留；範圍是CSV remaining_scope＋最新交付／blockers／覆蓋表及必要歷史disposition，**不是重新審查全部產品程式，也不是100個UC同版runtime重跑**。

| 分類 | 數量／原ID | 判斷與邊界 |
| --- | --- | --- |
| 本機PARTIAL_SCOPED | 176＝31F＋15R＋98UC＋32LA | 各自只證明記錄範圍；不同歷史SHA不能拼成同版原生全旅程 |
| SOURCE_ONLY | 7：F01、F02、F21、F25、UC188、LA27、LA28 | 依賴實際artifact／DB／安全／排程target。沒有這些綁定，不把額外mock或檔案計數當修補 |
| NOT_RUN | 1：UC134香港假期SLA | 原要求核准calendar；缺業務核准版本／預期日期及原生環境，不能自行捏造答案 |
| 已記錄、可獨立完成的本機核心缺口 | 本次審閱**未識別** | 有範圍的結論，不保證不存在未知缺陷；不為增加測試數猜下一個UC |
| 原生 | 70BLOCKED／114NOT_RUN／0PASS | 全部保持；原UC186 isolated-staging及LA26歷史fail不改 |

| 核心流程 | 既有證據 | 本輪處理／尚欠 |
| --- | --- | --- |
| 身份／登入恢復（UC99–118、195） | 歷史unit/component／injected actor SQL；REVIEW-3-disposition記錄三個原finding已修 | CSV中的舊「parent finalize REVIEW-3」不重新當新local failure；真Auth/cookie/SSRed session/換帳戶/撤權與HTTP仍需AP-01、07、09、10 |
| Today→公司／案件（UC119–140、158–166） | 歷史本機read models、權限／路由／指派／BR／無效參數與readback等scoped證據 | AP-03/05/07/08/10重走同版完整原情境；UC134及10k規模不因unit數變PASS |
| 文件／付款（UC141–157） | UC149/150/155等局部SQL/component；UC150是full-file retry/receipt，沒有宣稱byte-offset multipart | UC149舊文字「UC150 open」只由後續UC150 local slice承接；真storage/scan、相反決策HTTP、browser reload及完整原情境仍AP-04/09 |
| UC186合法交接與停用並發 | 4d63818同內容unit2780/288、SQL1多階段101案＋3work/6競爭次序、type/lint及531887ac的buildPASS | 上批local handover／admission及build缺口已補；本輪不重跑，AP-05/06驗真角色／HTTP／RLS及104責任native分頁 |
| 批次／匯入／訊息（UC110、167–184） | 500 mixed XLSX、選取snapshot、批次恢復及歷史分頁等分層證據 | AP-08/09；不把no-dispatch stub算訊息送達 |
| 維運／整體（UC185、187–198） | SQL last-Admin／schema／logical restore與局部demo等歷史證據 | AP-07/09/10/11：真tick、catalog、安全、restore/object、physical accessibility/performance及provider receipt |

舊remaining_scope是append-only歷史；後批明確關閉的local片段，不因舊字串仍在就重寫產品。其他尚未完整驗收部分照原記錄保留。Build node:crypto externalization／chunk等warnings仍是未關閉的browser／效能觀察點，本輪沒有失敗oracle或新repro可把它直接判成已證實local root-cause，也沒有稱它已解決。

APPROVAL-CHECKLIST.md將完整員工旅程及必要營運關卡分包；native-scenario-map.csv保留100個原UC各自route、role、preconditions、steps、expected及F/R/LA關聯，僅增加待批包，沒有新增execution evidence。原F/R/LA184列一律保持原CSV。
