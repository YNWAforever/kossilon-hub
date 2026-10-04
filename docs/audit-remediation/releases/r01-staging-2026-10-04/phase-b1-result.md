# R01 B1 v2：實際能力拒絕回條

使用者 `批准B一V二` 明確批准 request SHA256 `7243bf157f1d8622894d62900198bef30f2c33dbf2acb8b542242ebc44f50af4`。本輪基線 main `96ea6b2ac01c7f0a65e4e91af91092d3e838ff50`；獨立開發分支 `codex/r01-staging-b1-20261004`。原 request、SQL、Phase A、舊回條及原50UAT保持 bytes，批准記在[新 immutable receipt](../../evidence/2026-10-04-r01-b1-capability-blocked.json)，不改歷史 proposal。

## 實際結果

9項preflight GET核實 project `red-morning-00331124`、child `br-fragrant-sunset-aosoylhr`／parent `br-muddy-mountain-aov8bbku`、ready/non-default、零endpoint/compute、5branches、1database `neondb`。Auth config404/not enabled，domains/oauth404/integration not found；初始guard只接受config字句而停止，核對exact responses後接受相同管理層未啟用觀察。這不是copied Auth rows為空的證據。

只呼叫一次原 request 的 create endpoint（0.25–0.25CU、300s、passwordless=false、pooler=false）。工具回HTTP400／INVALID_ARGUMENT：`creating an endpoint with passwordless access disabled is currently not supported`。新endpoint ID沒有回傳。4項post-error GET核實child仍ready/non-default/0endpoint/0compute、原5branches身份一致；原production endpoint `ep-patient-block-aoxmgw78`仍綁原parent。已reconcile為failed/no new resource，沒有重送、改參數或suspend。正式source endpoint目前metadata的passwordless=true只作既有觀察，不能授權新clone改值。

單一catalog SELECT **not_run**（SQL hash `5e5d984a7487995b74808b39c133c05f5ad11c1747305ce3eca63fee15d2b58f`）；historical catalog/ledger/有效app-role與候選比較仍dependency-blocked。本地既有7contracts PASS/0FAIL/0SKIP／Node24.18.0；release verifier exit0／正式NO_GO。此前LOCAL空白PG18.6語法回條保持，不能當本輪hosted SQL。

## 精確能力缺口／owner input

目前[官方 OpenAPI](https://neon.com/api_spec/release/v2.json) 的 EndpointCreateRequest與EndpointUpdateRequest均把passwordless_access標為NOT YET IMPLEMENTED；已保存實際公開spec/hash。已安裝CLI4.13.0的help只證明有API passthrough，沒有跑authenticated API或新的create。沒有驗證能維持false的等價操作途徑。

Owner：**DB/Release + Neon control-plane support**。需確認此endpoint旗標的授權語義、能否實際建立/驗證false，以及一份維持已批准存取要求的provider-supported政策/操作。如果供應商只有不同旗標，先完成等價access-control審閱與新hash request，再取得該差異批准。不要把passwordless直接解釋為anonymous SQL，也不要從控制台登入機制推斷此clone已隔離。只提供policy/能力/target identity；不需要聊天明文secret。

官方[create API](https://api-docs.neon.tech/reference/createprojectendpoint)指出每branch最多一個RWendpoint，以及POST重試風險。這次有明確400及實際零resource reconciliation；保留回條，沒有用同參數重送、暫時true後再false或建立別的branch。

## 續作與回復

Task1 resource runtime-blocked；Task2 catalog未執行；Task3本地交付/審閱可完成。現有B1批准沒有撤回，也沒有擴至另一存取政策。維持既有no-compute child；本輪沒有新endpoint可供批准範圍內suspend，production/default/backups不變。不能suspend原production endpoint作回復。

R02/R03完整physical contracts、七logical owners/DDLfreeze/restore、restricted role、Auth/protected origin/R2/env/build SBOM、scheduler exact artifact/三次native ticks與原50genuineUAT仍各自blocked。原19historicalLOCALONLY／31blocked／0newgenuine；formal **NO_GO**。本輪沒有SQL、migration、ledger、role/Auth/env、deploy、tick、send或invite寫入。後續exact-head/mainCI若green只代表source交付。
