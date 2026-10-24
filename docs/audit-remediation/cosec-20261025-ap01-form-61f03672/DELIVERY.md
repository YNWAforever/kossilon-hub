# AP-01 metadata-only：單份可填授權表

香港日期2026-10-25。已重核HEAD／最新交付為`caefa0f2f88d4694d83800fbfaa0d8b2468abfa1`，root/origin/branch正確、clean起點；候選仍`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`。沒有後續交付或其他dirty工作要承接。

唯一需要填寫的文件是[AUTHORIZATION-FORM.md](AUTHORIZATION-FORM.md)：

- 已核實區預填repo/branch、交付基線、預期source、674檔來源及本機artifact manifest SHA256/433檔/14,269,548bytes，並清楚標明本機expected非native observed。
- A區填既有非正式target／owner／隔離依據／可信project-deployment定位及可選關聯metadata範圍。
- B區填既有平台唯讀存取與精確權限／request明細引用；metadata-only不需要QA Admin、DB憑證或業務資料。
- C區填日後明示決定、批准者、HKT起迄、接受或下調配額與表單/request版本。預設未授權，未知留白，沒有自動執行。
- 原metadata-only草案20attempts/10MiB/30分鐘、所有app/Auth/DB/browser/資源變更0的邊界及E0–E6證據引用保留。form-status.json僅是空白表的核對快照，不是第二份待填表。

本輪只跑本機文件/hash/Git blob與表單未填／未授權狀態核對；25批／2909個prior manifested files、674來源/config Git blobs及433個本機output核對。原184列／100UC對照／F/R/UC/LA編號及失敗、snapshots、resource拒絕不改，透過baseline/release-candidate的原檔hash與解析基底引用保留，沒有複製或改寫驗收CSV。

Unit/component/SQL/typecheck/lint/build本輪均NOT_RUN；先前同來源通過只作歷史。外部讀取、metadata執行、QA登入、Auth/app API、DB client/query、資源建立均0。沒有push/merge/deploy、正式資料或權限變更。原生70BLOCKED/114NOT_RUN/0PASS，BLOCKED／NO_GO。

尚待target、既有平台metadata存取及人類明示時窗/配額授權；填值本身不代表批准，也不關閉QA identity、DB實際身份/catalog/RLS或完整員工旅程等後續關卡。回復只需普通新commit revert本輪文件，無遠端資源／業務操作要撤銷，不改已發布歷史。
