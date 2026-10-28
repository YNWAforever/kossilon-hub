# 同版原生端到端驗收：只準備，未執行

BLOCKED／NO_GO。精確source以release-candidate.json及source manifest為準；先補齊check-summary.json內任何NOT_RUN_RESOURCE，才能建立可review artifact。沒有授權push／merge／deploy、建立正式資源、套正式schema或改真實帳戶／資料。

## 環境、角色與資料

擁有人須提供已批准隔離站URL、artifact/source SHA與checksum、runtime ID、DB project/branch/database/app-role、Auth tenant、storage/scanner sandbox的非秘密識別。先以metadata及實際連線身份比對，唯讀核對ledger／physical catalog／權限與依賴安全；同版或隔離證據缺失便不建立client。不要在聊天貼token／密碼。

使用已核准的合成Admin、同隊來源Staff、合法owner/reviewer接手者、另一隊Manager/Staff、Client及停用／不一致身份。綁定immutable Auth ID到internal user/profile/team，不靠email或QA名稱。資料為合成公司、三業務open parent及owner/reviewer工作、terminal／unrelated控制、真安全文件與拒絕文件版本、未付費／缺文件blocker。需要100+完整分頁時另核准精確synthetic批次fixture IDs及setup用量；本機104-entry fixture不代表可對任何遠端seed。

## 完整員工流程與門檻

1. 真Staff登入→Today找下一事、期限／首要blocker→開正確公司／案件；Manager範圍及Team B／Client URL/API拒絕，不能暫顯快取。
2. 真upload/quarantine/scan與當前版本hash→核文件／付款→readiness。未知／infected／舊版本、欠款／缺批准均blocked，不能手改scan/tick造成功。付款是內部ledger驗收，沒有實際轉帳。
3. Admin完整責任預覽→分開選合法owner/reviewer＋原因→讀齊分頁→取消預覽無寫入→確認。角色／team／skill／分工／current identity／版本拒絕，整批無半完成。正確公司及parent/work關聯，保留blocked／terminal／unrelated。
4. 故意遺失response→同操作ID讀收據／重試，不能多做。未知取消必須由server journal fence，延遲原請求不得再提交；原操作已commit則回原receipt，不假報取消。Browser reload／帳戶切換／舊頁延遲回應不得刪新操作的恢復紀錄。
5. 未交完停用拒絕→交完後新revision停用→舊session即時拒絕。新案及owner/reviewer指派對停用的兩向競爭，核HTTP conflict／locks、金額及審計不被交接改寫、獨立app-role資料回讀。接手者開正確案件／工作，Today與case顯示一致。
6. 每步保留API request/response facts、獨立資料與object讀回、取消／返回／reload；含空態、錯誤、重試／重複及並發。原生工作旅程不能靠本機superuser SQL、mock RPC或toast替代。

## 待批操作、用量及清理

建議上限尚未授權：單一隔離站／同一候選、2個同時browser contexts、200業務讀取、50合成commands、4個≤5MiB檔案。100+分頁setup須另列精確批次IDs／寫入量，不能暗中超過上限。實際付款、真訊息、正式交件、付費AI／其他服務呼叫均0；需要provider真整合時另列recipient/destination/receipt/cost再批准。

待批項目分開：接入指定已存在隔離URL並建立自己的QA session；核實精確角色與target；對預先manifest IDs／keys做上述合成業務／upload／sandbox scan寫入；若需新站／部署／migration，先交具體target、差異、費用、備份與rollback候選再另批。本輪不執行任何一項。

Cleanup只處理可證明owned的精確QA IDs／object keys或另獲批准的完全disposable branch；重核身份／inventory／client closure與前後projection。保留不可刪audit，不blanket delete、truncate或停用retention，不動正式帳戶。需要整體dispose須列精確resource ID再批。本機512MiB／1CPU／1GiB tmpfs授權沒有延伸到原生資源。

員工日常可用之前仍要：同版artifact／required CI及DB相容／安全接受、真身份與權限、完整Today→case→文件／付款→操作→API/data/reload、核准calendar／scheduler freshness、backup/storage恢復、可及性／效能，以及日常必要的受控provider／filing receipt或明示人工接手。原生缺口保持blocked。
