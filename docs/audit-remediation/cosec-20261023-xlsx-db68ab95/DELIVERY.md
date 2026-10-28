# Kossilon — 500列混合 XLSX 本機驗收

本輪已補齊指定的 **500列混合有效／重複／無效XLSX實際bytes解析 → preview → apply → 中斷／取消／重試 → 獨立資料回讀**。現有產品守門行為符合期望，沒有改寫正確的產品邏輯或降低斷言。**只驗本機server handler／repository／隔離SQL；原生驗收仍blocked，release gate仍NO_GO。**

候選source：`fc87ad44cc1408174ad91bf74d0c382138e55256`；branch `codex/cosec-20261023`。開始時HEAD `7862c9ba9deb6a61ed181696bf087d23c6ae089c`、工作樹乾淨；repo及AGENTS／RTK已核對，沿用既有隔離worktree `C:/Users/laich/Documents/kossilon-hub/cosec-20261023`，origin `https://github.com/YNWAforever/kossilon-hub.git`。本輪末main仍為 `1c57a67213af72bff8d776694e6ed8c986b921db`；production只保留提供的歷史SHA，未接觸或重新核實。

| 驗收 | 真結果 |
| --- | --- |
| 實際檔案 | [mixed-first.xlsx](db/mixed-first.xlsx)，15,819 bytes，SHA256 `4f7082dfd0ee171aa3c0f66b4e651056a63eae609bf837b7d0c3f9de6f91bd05`；genuine compressed OOXML，500個data rows全部解析及保存，DB batch使用相同真檔hash／size／parser version |
| Preview | selected500／eligible350；100列重複（50組兩列均擋）、25欠公司名、25欠AR due，共150 blocking，來源確認不可繞過；500列相同invoice不作identity |
| Apply及恢復 | 37個真commit後合成中斷；獨立client回讀，cancel313、重複cancel0；只review313個cancelled IDs，新job並發冪等，chunks100/100/100/13，再跑0；舊preview/key重播不產生新job |
| 回讀 | 350個不同case/payment/work/company，350個不同journal row IDs；有效350列applied，阻擋150列維持null；整批仍pending_review／appliedAt null；原檔replay仍同batch |
| 角色與副作用 | Staff stage／偽稱Admin execute／其他Admin讀非自己job均拒絕；只選150阻擋列仍eligible0、job partial、worker0。Payment仍pending且未paid；credit-note來源日期只作觀察；outbox0，無dispatch |

完整情境、target身份及證據限制見 [R26.4-XLSX](R26.4-XLSX.md)；500列來源、預覽及精確IDs／回讀見 [事件檔](db/xlsx-events-first.jsonl)及 [摘要](readback-summary.json)。Fixture為合成資料，不代表原生Auth或真實業務操作成功。

| 本輪實際執行 | 結果 | 證據 |
| --- | --- | --- |
| `npm test -- --project unit --maxWorkers 1` | 266 files／2470 passed、0 failed、0 skipped | `unit-final.txt` |
| DB project指定mixed-XLSX及既有normalized500兩檔 | 2 files／2 passed；不是前批全DB suite重跑 | `db/db-500-first.txt` |
| 新6項parser＋既有reader/mapping/normalize subset | 83 passed；已包含於完整unit數字 | `sidecar-unit-green.txt`、JSON |
| `npm run typecheck` | exit0 | `typecheck.txt` |
| `npm run lint` | exit0，0 errors／1個既有Fast Refresh warning | `lint-final.txt` |
| `npm run build` | exit0，local cloudflare-module，未部署 | `build-final.txt`、`build-artifact-manifest.json` |

新增兩個測試檔（6項pure parser＋1項mixed SQL），新增genuine workbook builder；從舊workbook test原樣抽出ZIP writer作共用helper，並將新DB檔加入既有serialized registry。六個source/test/helper檔的diff及指紋在 `source.patch`／`source-candidate.json`。測試在開始HEAD加dirty候選執行，source freeze後未改，普通本機commit只固定相同bytes。沒有將前批unit／DB／browser數字合併成新結果；本輪未重跑browser，原demo證據仍留在前批。

本輪只建立一個新512MiB tmpfs container；任何DB client／readiness／migration／fixture／cleanup之前，均重新核對完整container/image/labels/port/mount/path；TCP與容器內server system ID相同。只在該空白DB執行schema與本輪精確immutable SLA前置IDs，沒有application seed／正式migration。兩個test fixture按自己的精確IDs清理並回讀為0；保留的immutable foundation比對IDs後，隨exact container移除；credentials已刪除，沒有bypass trigger或更動其他容器／daemon。見 `cleanup-final.json`。

原35 F、15 R、100 UC、34 LA，共184列，完整保留在 [acceptance-results.csv](acceptance-results.csv)。原編號、original row JSON、歷史結果與native結果逐欄不變，只追加F09／R26／UC181–182的本機證據；native仍70 BLOCKED／114 NOT_RUN，0 pass。前批所有失敗及manifest保留不改寫。新fixture最初的missing-module collection failure另存 `sidecar-unit-red.txt`，屬測試建置階段，不宣稱產品RED/GREEN；首次真混合DB執行即通過。

後續見 [blockers](blockers.md)：本機500 mixed binary gap已補；原生Auth／HTTP upload／browser reload、多角色、裝置、native ticks、provider/scanner/storage、代表性p95及release/rollback仍待對應隔離身份與授權。本輪沒有push、merge、deploy、正式資料／帳戶／權限變更、真實訊息／付款／交件或付費服務。

交付資料：[候選版本](release-candidate.json) · [驗收CSV](acceptance-results.csv) · [檔案manifest](evidence-manifest.json) · [可重跑唯讀交付檢查](verify-delivery.ps1)。
