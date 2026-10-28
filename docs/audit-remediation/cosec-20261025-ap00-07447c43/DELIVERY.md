# AP-00：本機預填完成，最小待填三組

香港日期2026-10-25，從交付`2edfc24d37bc5325c23fa8ea29a76876fd034176`／候選`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`續做；HEAD/remote/branch/root/dirty state已重核，沒有後續交付或其他工作要覆蓋。只新增本機文件及驗證收據，產品／測試／migration0改動。

## 可供審閱的結果

- [LOCAL-PREFILL.md](LOCAL-PREFILL.md)／[ap00-prefilled.json](ap00-prefilled.json)：填妥source/parent/branch/HEAD、674檔來源指紋、本機artifact manifest及SHA256、433檔output、歷史同來源unit/SQL/type/lint/build收據、原184列及100UC map、角色要求、Core與setup配額／合成資料／retain清理草案。全部有證據／草案標籤。
- [MINIMUM-INPUT.md](MINIMUM-INPUT.md)／[minimum-input-template.json](minimum-input-template.json)：縮成三組——現有隔離站及owner/可信metadata識別、既有QA Admin及安全存取、日後明示子範圍/時窗/配額批准。首輪只建議metadata→identity/catalog readonly，不包含業務資料；業務fixture及其他角色按其AP包再補。
- [binding-register.json](binding-register.json)：逐一分配31個尚未核實native欄位；14個延至文件/provider/calendar/fault/restore/效能等後續包，其餘以owner提供可信位置＋日後獲批的唯讀核實補齊。沒有把31欄都變成使用者即時問題。
- [approval-request.json](approval-request.json)：保留原13個AP packet內容、依賴、Core預算及全部未批准狀態，只新增本輪prefill/最小輸入指引與基線。實際native bindings仍全null、approved_packet_ids空、execution_enabled=false。

本機artifact manifest SHA256不等於部署artifact checksum；同樣，已dispose的本機SQL IDs不能作原生DB target。QA alias不等於真Auth/internal/profile/team/revision。提供URL或帳戶識別亦不等於批准執行。

## 核對／保留

本輪只跑本機文件／JSON／CSV／hash／Git blobs完整性檢查。23批／2882個prior manifested files、674個來源／config檔、433個output（14,269,548bytes）核對；原184列、100UC map、原F/R/UC/LA編號、RED/snapshots／resource拒絕均不改。原CSV在[上一交付](../cosec-20261025-native-plan-fccb7c22/acceptance-results.csv)，其evidence_paths仍按上一交付指定的build目錄解析，本輪沒有複製或改寫它。

Unit2780/288、local SQL1（注入session＋superuser）、typecheck/lint/build PASS是**歷史同來源**證據，本輪全部NOT_RUN。Native Auth/HTTP/RLS/browser/provider、CI、scheduler、restore也全部未執行；沒有連外讀取、資源建立、DB client、fixture、migration或帳戶／資料變更。原生70BLOCKED/114NOT_RUN/0PASS、NO_GO。

## 尚欠

AP-00本機部分已準備完，原生target/角色/資料與日後執行批准仍未齊。可先由owner提供三組最小資料；沒有隔離站就如實填無，不能自行建站。日後若只批metadata子範圍，不會視作全AP-01、Core或其他AP已批／已驗。

員工日常可用仍欠實際同版artifact/CI/DB/安全接受、真身份與權限／撤權、完整Today→case→安全文件／付款／blocker→授權操作→API／獨立資料／返回／reload，以及核准calendar、scheduler、storage/backup恢復、可及性／效能及必要provider/filing receipts。後續完整範圍仍按[原待批計劃](../cosec-20261025-native-plan-fccb7c22/APPROVAL-CHECKLIST.md)，沒有豁免任何必要關卡。

沒有push/merge/deploy或開main自動部署。文件可用普通新commit revert本輪；無業務／外部資源需回復，不改已發布歷史。
