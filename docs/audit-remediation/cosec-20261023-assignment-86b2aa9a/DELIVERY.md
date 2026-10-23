# Kossilon — UC130／UC131 本機核心情境續驗

本輪補齊 **雙人同時指派／員工失效後提交舊選擇** 的本機server handler、真SQL及component證據，並修補衝突識別與畫面恢復。原生Auth／HTTP／browser旅程仍未完成，**release gate維持NO_GO**。

候選source：`c298685341603c3c30d953e03aede262f1875455`，branch `codex/cosec-20261023`；開始HEAD `8a0fbdcc860981d43fb9e12f794d7b549e331435`且工作樹乾淨。Repo／origin／AGENTS／RTK及保留worktrees已核對；開始和收尾遠端main均為 `1c57a67213af72bff8d776694e6ed8c986b921db`。Production只保留使用者提供的歷史SHA，未存取正式站。

| 成果 | 本輪真結果 |
| --- | --- |
| UC130 | owner／reviewer各用三條獨立SQL sessions，pg_blocking_pids證明實際鎖等待；甲version1成功、乙舊version409且無覆蓋。重送不多寫audit；乙明確重讀及重新確認version2後才得到version3，assignment／timeline逐筆actor、前後人選及expected_version一致 |
| UC131 | 推薦後停用users／staff profile／兩者，以及撤銷skill，舊選擇409；work version及audit不變。重新推薦及改選後只寫一次。另有persisted actor失效403及Staff／Client／外team／無team／inactive／偽稱Admin拒絕 |
| UI恢復 | 任一提交錯誤都要求使用者明確重讀工作和人選兩者；保留角色及例外理由，清舊選擇，再確認新version。missing／closed／讀取失敗、背景變更、未知結果、取消後重開、同turn重複、pending dismissal、換actor／late success均補驗；沒有自動重送 |
| 既有正確行為 | 原case/work鎖及version CAS已阻止覆寫，本輪保留。修補為已知衝突409／actor失效403、確認不合資格與未知DB錯誤分開，以及上述畫面恢復；沒有新增schema或擴張權限 |

新隔離SQL為 **1 file／6 passed**；UI **30 component cases passed**，其30項已包括在下列完整unit數字內，不相加。兩層分開：component的Auth／RPC／router為mock；SQL用真repository及in-process handler，actor為合成staff表身份。**沒有聲稱這是原生端到端接受。**

| 本輪必要檢查 | 結果／證據 |
| --- | --- |
| 完整unit／component，maxWorkers1 | **267 files／2497 passed**，exit0；`unit-final.txt/json` |
| 真SQL assignment補驗 | **6 passed**，exit0；`db/db-assignment-expanded.txt/json`、`readback-summary.json`及精確事件檔；不是前批146 DB suite重跑 |
| typecheck | exit0；`typecheck-final.txt/json` |
| full lint | exit0、0 errors／1個既有work-queue Fast Refresh warning；`lint-final.txt/json` |
| build | exit0、local cloudflare-module、demo auth關閉；`build-final.txt/json`及`build-artifact-manifest.json`。未deploy，既有chunk／code-split警告保留 |
| Browser／21 Node handler | 本輪未跑；前批結果保留原版範圍，不套成本輪新SHA的結果 |

七個source／test檔固定於 `source-candidate.json` 及 `source.patch`。`source-freeze.json`綁定aggregate內容；`db-source-freeze.json`證明最後6 SQL後backend內容沒有變；sidecar兩檔亦有獨立fingerprints。普通本機source commit只固定已驗候選；交付文件另以普通本機commit保存，未改已發布歷史。

隔離target：本輪新container `c9547fc4528903fff2ed0e833ffe49f4aa10aecf14cc74af5f2756baf011e250`，固定image、run/repo labels、512MiB／1CPU、無mount、tmpfs、loopback `127.0.0.1:58639`、database `cosec_assignment_86b2aa9a`。每次client前重新gate；TCP與容器內system ID均為 `7699828678718709799`。只在此空白target套現有schema及三個精確immutable SLA前置IDs，沒有application seed或正式migration。最後所有本輪業務／身份IDs回讀0，outbox0，精確容器及credential檔已移除，原有313個容器IDs仍在。見 `cleanup-final.json`。

修補前證據保留：真正SQL契約RED為5項缺409；最初fixture-origin被paged queue正確排除另列setup失敗。原UI 16 failed／9 passed、後續重複alert／背景資料／取消重開失敗，以及父工作中間4 failed／50 passed均留log及snapshot，沒有以最終成功覆寫。細節見 [UC130／UC131](UC130-UC131.md)及sidecar-report.md。原四批manifest的399／108／45／394個entries hash亦未改。

[驗收CSV](acceptance-results.csv)完整保留35 F、15 R、100 UC、34 LA，共184列，原original_row_json／歷史／native欄位及關聯不變，只在UC130／UC131及R23追加本輪local scope。Native仍 **70 BLOCKED／114 NOT_RUN／0 pass**，不是產品通過率。

後續見 [blockers](blockers.md)：UC130／UC131真Manager session、HTTP錯誤序列化、browser雙頁／reload及RLS尚待同版原生隔離target；其餘裝置、provider、排程、效能、restore與正式接受亦維持原邊界。下一個本機補驗可先檢查UC155相反付款決策並發或UC135–137客戶建立／重複／BR；開始時須再核對既有覆蓋與新隔離資源。

本輪沒有push、merge、deploy、開main自動部署、正式資料／帳戶／權限變更、真訊息、付款、交件或付費服務。程式回復候選為普通新commit revert本輪source；不授權production降版或資料回復。

交付：[候選版本](release-candidate.json) · [回讀摘要](readback-summary.json) · [驗收CSV](acceptance-results.csv) · [證據manifest](evidence-manifest.json) · [唯讀交付檢查](verify-delivery.ps1)。
