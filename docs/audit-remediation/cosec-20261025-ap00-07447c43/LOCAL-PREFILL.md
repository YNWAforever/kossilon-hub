# 已填妥：本機可證明的AP-00資料

| 欄位 | 已填值／證據層級 |
| --- | --- |
| Repo/root | `https://github.com/YNWAforever/kossilon-hub.git`；`C:\Users\laich\Documents\kossilon-hub\cosec-20261023` |
| Branch／交付基線 | `codex/cosec-20261023`；`2edfc24d37bc5325c23fa8ea29a76876fd034176`，clean起點，無後續交付 |
| 產品候選／parent | `4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`／`104af5c4875d2f10b595ec330fcb2e1d07e87201`；674個來源／config Git blobs核對 |
| 本機artifact manifest | `../cosec-20261025-build-d29cd5ec/artifact-manifest.json`；SHA256 **189606711dca25c7dbc522903f6657b002efab2edca33ee9bf4a7c22f74ca1b4** |
| 本機outputs | 433檔／14,269,548bytes，逐檔hash吻合；**不是deployed artifact checksum** |
| 既有同來源檢查 | Unit2780/288files（含targeted44）、local SQL1多階段（注入session＋superuser）、typecheck/lint exit0、build exit0/34.670秒；receipt與來源在ap00-prefilled.json。全部是歷史、本輪未重跑 |
| 原範圍 | 原184列＝35F/15R/100UC/34LA；100UC原條件及關聯已有待批map；native70BLOCKED/114NOT_RUN/0PASS |
| 角色要求 | 21個alias與適用階段已填入role-bindings-template.json；**真Auth/internal/profile/team/revision全未填、不授角色**；metadata-only不用先提供21個身份 |
| 配額草案 | 原Core1站/2contexts/200reads/50commands、檔案及setup/extension上限保持原proposal；另列較小首輪readonly草案，未批准 |
| 合成資料規格 | Core fee1000/ledger300/proof700 HKD、Core setup100 logical/2500 physical rows草案已填；非銀行回執，**native driver／真fixture IDs未填** |
| 清理草案 | 首輪retain，不建資源／不刪資料；只結束自己的獲批session/client。前批已dispose的本機container及fixture不作原生target或可重用ID |
| 資源政策 | 本機重型DB/runtime原3GiB RAM閘保留；先前512MiB/1CPU/1GiB tmpfs只屬本機disposable範圍，不延伸至遠端 |

本輪可填的是**本機已驗值與草案**。Actual deployment/project/DB/role/Auth tenant、真角色與資料、calendar/provider/restore/費用/清理IDs沒有本機證據，仍為null。binding-register.json逐欄列明31個native欄位由誰、在哪一階段補；其中14個只屬後續包。不得用local SQL target、歷史production SHA、fixture名字或artifact manifest hash來冒充actual native值。

AP-00狀態是「本機預填完成，native bindings及執行批准待補」，不是「原生環境已ready」。原13個AP操作、依賴、Core預算與批准狀態不改；首輪子範圍不關閉其他角色或原UC。原始計劃與184列仍在上一交付，本輪只加引用與hash，避免無意改寫舊evidence_paths。
