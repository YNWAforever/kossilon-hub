# AP-01 metadata-only：單份可填授權表

**最新：本輪已獲明示窄授權並實際完成6次Vercel metadata讀取，沒有進行原生功能驗收。** 請求前HEAD為19f03e55，03:17:50至03:47:50 HKT固定窗口，03:28:01完成並停止；保守計量8,806bytes，metadata text4,667bytes。原表及[實際回條](AP01-METADATA-EXECUTION.json)已更新；下方早前「只準備」段落保留為歷史，不代表這次未執行。

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

## 原表本機查找補填（2026-10-25 HKT；基線19858ef0）

依最新使用者指示只更新原AUTHORIZATION-FORM.md、其form-status.json及本交付附註，**沒有新建準備包／目錄**。HEAD核對為19858ef0fdd27c70cea4a91010f17a1be0b16f49，候選完整SHA及manifest hash不變，開始時無dirty工作。

查找範圍是本worktree既有非秘密docs/runbooks、歷史Vercel／Neon metadata、R01 staging Phase A/B1回條、當前生成Wrangler metadata，以及五個已登記同repo worktree的`.vercel/project.json`存在性。沒有讀.env／credential store、沒有呼叫平台connector或網絡。結果：**未找到可核實適用本輪／候選4d63818的既有隔離目標**。

原表逐項加入來源：2026-10-03歷史Vercel demo project `prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`及team ID；2026-10-04舊R01 no-compute DB branch `br-fragrant-sunset-aosoylhr`。兩者僅作線索，沒有同版部署、可用URL、owner、目前存取／隔離或二者綁定的證據，不能合併為UAT target。SQL技術角色neondb_owner、GitHub登入／平台team均不代填資源owner。Runbook的production／demo網址也不作現有UAT證明。

原表授權決定明填NOT_AUTHORIZED；20次／10MiB／30分鐘仍PROPOSED_NOT_APPROVED，批准者與HKT起迄UNKNOWN。Owner及目前平台唯讀存取方式／範圍UNKNOWN；QA Admin／DB憑證仍不需要。仍欠最小三組：選定隔離target＋owner及可信metadata識別；現行平台唯讀存取＋精確scope；批准者／HKT起迄及配額明示批准。沒有環境可直接填無，不自行建立。

查找前已核對674個來源Git blobs、2909個prior manifested files及原19858ef0表單bundle的hash、原184列CSV。舊evidence-manifest.json／verification-report.json維持原樣，仍證明19858ef0 Git版本；它們不是更新後三個工作檔的manifest。初表bytes保留於Git19858ef0，舊失敗／CSV／100UC map均未改。補填後只做本機diff、JSON/hash與Git歷史完整性核對；不重跑舊package verifier來把新表冒充原frozen bundle。

本輪只補表，應用測試與metadata執行均NOT_RUN；不連外、不登入QA、不連DB、不建資源、不push/merge/deploy。Native仍70BLOCKED／114NOT_RUN／0PASS、BLOCKED／NO_GO。

## 委託選擇（you decide；基線5c0e1c8d）

在原表選歷史Vercel `kossilon-hub-demo`／`prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`為唯一待核實候選；首步只擬查該project/deployment metadata，保留20次／10MiB／30分鐘總上限，不納DB/Auth/CI或舊staging DB。Owner、唯讀權限、同版部署及實際HKT起迄仍UNKNOWN，時窗不在準備階段啟動，NOT_AUTHORIZED／NO_GO不變。

只更新同三個既有檔案，沒有新包／目錄、重問資料清單或外部操作；原184列及失敗／歷史manifest不改。只做本機JSON/hash/diff核對，沒有應用測試或native驗收。首次patch因一處檔案路徑不完整整批拒絕，已核對沒有寫入再更正，並非產品或原生測試失敗。

## 實際AP-01 metadata讀取（本輪明示授權；基線19f03e55）

使用既有Vercel MCP連線，只查teams、精確名稱project搜尋、唯一project deployments及其Git metadata。Live回傳1team與1個精確project匹配，無next page；project ID `prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`，project.accountId為`team_qvzlsFmfCsLkgItSypqHjw3z`，team name `ynwaforever's projects`／slug `ynwaforevers-projects`。唯一性限當前連線回傳的team/scope。六個GET讀取回傳成功，沒有新增連線、帳戶、憑證、權限；並未證明credential是exclusive readonly角色或具名business owner。

最新可見deployment `dpl_2YSZmZTxQzxPLsL3nUnUF6vLeeEY`，固定URL `https://kossilon-hub-demo-dpp5u56nf-ynwaforevers-projects.vercel.app`（未訪問），target production／state READY，created HKT2026-07-19 18:37:56。最新Git SHA即使要求Git repo metadata仍未提供，故UNKNOWN。同project以候選4d63818完整SHA及請求前交付19f03e55完整SHA篩選各0筆metadata，沒有證明同版artifact；也不能因此斷言未標SHA的最新手動artifact必定不同。較舊dpl_8HRm…的e2ac85e5…只適用該部署，不套用至最新。

03:17:50.889 HKT在首次遠端請求前寫入窗口，固定截止03:47:50.889；03:28:01.873停止，elapsed610,984ms。共6請求，必要分頁0、遠端tool errors0；req3的wrapper解析TypeError保留，從本任務自己的原MCP completion event取得回應，沒有API重試。初次byte比對用了不同connector封裝表示，後來全部六次統一按completion result UTF8大小保守扣額，並另列metadata text bytes；原失敗與校回方法記入回條。這不是讀Vercel logs或客戶資料。

結果分層：project/team及deployment描述已核實；最新Git SHA、候選artifact／同版等價、DB/Auth/data isolation、business owner及exclusive readonly RBAC仍未知。Preview/demo名稱、production target或READY都不構成DB/Auth隔離證據。只metadata範圍有真讀取，QA/DB/Auth連線、SQL、env values、app route／網站訪問、provider processing、resources/deploy/push/merge均0。原184列／100UC map及Native70BLOCKED/114NOT_RUN/0PASS不變；metadata成功不解除NO_GO。

本輪沒有新準備包，只有在原目錄新增**實際執行回條**、更新原表／狀態／候選資料／本附註。原19858ef0 frozen manifest/report保留於原檔及Git，沒有重寫舊失敗或把新內容冒充舊驗證。應用unit/component/SQL/typecheck/lint/build本輪NOT_RUN；只另做本機來源/CSV/hash及回條完整性核對。
