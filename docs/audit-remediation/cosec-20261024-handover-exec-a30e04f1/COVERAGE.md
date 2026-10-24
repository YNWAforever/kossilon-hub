# 核心流程覆蓋：保留原184列及證據層級

起點交付104af5c／候選209aef6；本輪source候選4d63818，只續做原UC186（F08／LA26）。原35F／15R／100UC／34LA、原not-tested／fail、關聯與原original_row_json保留。Native仍70BLOCKED／114NOT_RUN／0PASS。最後typecheck／lint通過，build未達原3GiB門檻、未啟動，NOT_RUN_RESOURCE。

| 原流程／UC | 已有證據 | 本輪／仍欠 | 必須原生環境 |
| --- | --- | --- | --- |
| UC99–118、195 身份／權限 | 歷史mock及assumed actor SQL；本輪current Admin/profile/identity拒絕 | 沒有真Auth登入／session／RLS驗收 | 同版真Admin/Manager/Staff/Client與跨隊、舊session／換帳戶cache拒絕 |
| UC119–140 Today→公司／開案 | 歷史unit/component、SQL及局部demo | 本輪沒有把分段證據拼成完整旅程；UC134核准calendar仍缺 | 真角色Today→正確公司／案件、期限／blocker、返回／reload |
| UC141–157 文件／付款 | 歷史local contracts、UC149/150恢復、UC155相反決策SQL | 本輪沒有改文件、付款、readiness或造provider成功 | 真安全bytes／storage／scan、proof與ledger、readiness→API／資料回讀／reload |
| UC158–166 三業務案件 | 歷史read policy／routing／checklist／invalid transfer SQL | 本輪把三業務parent及active work納入合法交接，修正公司關聯拒絕；不是新辦妥註冊／交件 | 真角色、正確上下文／文件／付款及正常完成功能 |
| UC110、167–184 批次／通訊 | 歷史500 mixed XLSX與局部SQL | 本輪outer import/bulk/maintenance/manual reminder admission僅靜態與unit支持；沒有真provider發送 | 真批准、續傳／撤權、provider／destination／receipt閉環 |
| **UC186 離職交接** | **本輪真SQL完整多階段旅程PASS**，全unit2780／288files；targeted44包含其中 | **101案＋3工作**全範圍，owner/reviewer合法轉交，拒絕／回滾／重試／取消／audit／readback、6個兩向競爭；最後build/type/lint以check-summary.json為準 | 原要求isolated-staging UAT未執行，LA26歷史fail不改；原生Auth/HTTP/RLS、browser reload、實際帳戶／provider lifecycle仍blocked |
| UC185、187–198 維運／整體可用 | 歷史last-Admin、schema admission、logical restore及局部demo | 本輪不是正式RTO/RPO、真tick、安全接受或代表性效能證據 | 同版artifact／DB／依賴安全、核准calendar、scheduler、backup/storage恢復、可及性與效能 |

UC186原定義為「員工有未完成案、工作及review責任；預覽→確認→停用→重讀；完整交接到合法同事，列明未處理責任及審計」，環境為isolated staging。本輪只關閉相應本機case/work核心缺口，不將本機PASS變成原UAT PASS。

本輪新增失敗全部留存：原creation-vs-disable SQL RED、missing-command UI RED、延遲UI回應刪pending的RED、同隊跨公司錯誤關聯RED、交接清除blocked的RED。4項panel test最初因兩個選單同名option而失敗，保留targeted-ui.txt，修正selector而非放寬產品期望。Resource gate拒絕均為NOT_RUN；原始失敗時RAM讀值不以後來恢復值替換。
