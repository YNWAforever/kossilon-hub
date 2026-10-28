# AP-01 metadata-only 最小唯讀準備

香港日期2026-10-25。起點交付`c8df4219f4c0b064aba35ec1d9f8388deb2654f1`／候選`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`；HEAD/最新交付/root/origin/branch/dirty state已重核，沒有後續交付或其他改動要承接。只新增文件，產品／測試／migration不改，不reset或改已發布歷史。

[AP-01-METADATA-ONLY.md](AP-01-METADATA-ONLY.md)是主要審閱件，包含三層前置條件、M0–M6最小步驟、20次分配、用量及E0–E6證據清單。[metadata-only-request.json](metadata-only-request.json)保留精確待批sub-scope／quota／觀察欄位；[evidence-template.json](evidence-template.json)只是NOT_RUN模板，沒有虛構request IDs、時間或metadata結果。

## 分開的前置條件

- **Target：metadata-only所需。** Owner指定現有非正式target／可信project-deployment定位，既有平台control-plane唯讀存取與精確request/fields/副作用範圍，再有日後獨立明示AP-01 metadata-only/HKT/quota批准。平台metadata帳戶不是Kossilon QA Admin。本輪未取得這些native bindings或執行批准。
- **QA Admin：延後。** 本子範圍不登入QA、不讀session/actor，也不發magic-link或invite。既有QA Admin安全存取、Auth ID/profile/team/revision在後續identity範圍另批核實；缺QA Admin不阻塞metadata準備。
- **DB：延後。** 本子範圍只可擬讀provider資源描述，不需要DB憑證／連線，不能SELECT1或import/instantiate client。實際server/role/catalog/RLS要待metadata target綁定＋獲批安全唯讀存取，另過連線閘；branch/endpoint描述不是server身份證據。

## 最小配額與證據

提案為1個既有target、20次metadata read attempts（6部署＋4DB資源＋2Auth綁定＋4CI/artifact/security metadata＋4安全重試/page預留）、10MiB response總量、30分鐘。原AP-00較大readonly草案及Core200reads/50commands未被改寫或批准。本子範圍的QA/Auth/app/業務讀取、DB query/client、browser、artifact/object下載、provider processing/send、上傳、新資源／喚醒、帳戶／角色變更、刪除/dispose、新增付費、push/merge/deploy均0。

E0 scope/request manifest、E1 deployment、E2 DB control-plane、E3 Auth control-plane、E4 CI/artifact/security、E5 usage/failure ledger及E6 disposition/hash manifest逐項規定來源/ID/時間/hash與可推論層級。Expected source／本機manifest與observed target各自保存，checksum種類/範圍不相同不能當artifact吻合；不把metadata或CI狀態升格為native功能/DB/RLS PASS。只封存本機sanitized證據，不動現有平台session或資源。

## 本輪核對／未執行

只跑本機文件／JSON／CSV／hash／Git blob完整性核對：24批／2899個prior manifested files保持原樣；674個來源/config Git blobs、433個本機outputs（14,269,548bytes）核對；原184列、100UC map、F/R/UC/LA關聯、歷史RED/snapshots及resource拒絕不改。原CSV及evidence_paths解析基底仍以release-candidate.json的引用為準，本輪不複製或改寫。

Unit2780/288、local injected-session SQL1、typecheck/lint/build PASS均是歷史同來源證據，本輪全部NOT_RUN。**本輪metadata讀取0、外部存取0、QA登入0、DB/client0、資源建立0、原生驗收0**。只跑文件完整性檢查不新增產品測試通過數。

執行批准仍空、execution_enabled=false；全部observed metadata欄位null、evidence ledger空。本次準備完成，不代表target READY或AP-01整包完成。原生70BLOCKED／114NOT_RUN／0PASS，BLOCKED／NO_GO。

仍待owner指定target與平台metadata存取／request範圍、HKT及配額；提供資料不等於批准。本輪不要求QA Admin或DB憑證來完成metadata-only文件。員工日常可用仍欠同版artifact/CI/DB/安全接受、真身份/權限/撤權、完整Today→case→文件/付款→操作→API/data/reload及calendar/scheduler/restore/可及性/效能/provider回執，沒有因縮小子範圍而豁免。

普通本機文件commit交付；回復只需新commit revert本輪文件，沒有業務或外部資源要回復。沒有push／merge／deploy或main自動部署設定變更。
