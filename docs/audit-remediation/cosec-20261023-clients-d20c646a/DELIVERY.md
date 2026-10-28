# Kossilon UC135–137 本機實作與驗收交付

已補齊客戶建立、重複檢查及 BR normalization 的本機驗收，並修補重現的空白必填及表單恢復問題。Source candidate **b3d02f218b8de915f0ac1a544ebc85f1bf262764**，父版 **1b8dffc256b934ed11864a07883c80d8de5f8749**，branch `codex/cosec-20261023`。精確 files／Git blob 等價見 [候選資料](release-candidate.json)、[source manifest](source-candidate.json) 及 [Git bytes](git-blob-equivalence.json)。最終文件提交只整理本資料夾。

UC135 的 3 個文字必填原來會把全空白寫成公司、聯絡人、秘書及時間線，已用真隔離 SQL 重現並保存失敗 rows。新增 schema 改為 trim 後檢查，逐欄修正後可正常建立。表單現在將焦點移到第一錯誤並關聯文字；重複 CR／BR 錯誤保留所有輸入；防同 render／pending 重複提交，守住 pending 取消／Escape／close，保留同一 session 的草稿並可手動重試。沒有 owner／team 選項時明確拒絕，選項恢復後須明確選擇。

UC136／UC137 的既有 DB unique constraints、field mapping 及 normalize 規格正確，保持原版。新增本輪 sequential／concurrent duplicate、重試及獨立連線資料回讀：完整 certificate 儲存為 `12345678-000`，不同換證 suffix 不能新增重複公司；原子 transaction 失敗不留下 company／child／timeline。

| 本輪檢查 | 實際結果／層級 |
| --- | --- |
| 完整 unit | 268 files／**2538 passed**，0 failed／0 skipped；[log](unit-final.txt) |
| Component | **25 passed**，已包含在 2538；真 React／Radix＋jsdom，RPC／toast mocked，未算 SQL 或原生成功；[handoff](sidecar-20261023130302105-46579446-handoff.json) |
| SQL | **10 passed**，全新 disposable PostgreSQL；[log](db/db-clients-green.txt)／[回讀](readback-summary.json)；最終只對 SQL 測試補 type／lint comment，emitted JS 等價可重驗，沒有重跑已移除 DB |
| Typecheck／lint | 最終 exit 0；lint 1 項原有 work-queue.tsx:49 Fast Refresh warning；初次 TS2345／TS2339／no-unsafe-finally 及修正證據保留 |
| Build | exit 0，cloudflare-module、demo Auth=false；419 個本機 build files 已 fingerprint，**未部署**；chunk／plugin 等 warnings 保留原 log |
| Authenticated runtime | **NOT_RUN／BLOCKED**；沒有真 Auth/session、HTTP serialization、app-role/RLS、browser 返回／reload 或原生帳戶驗收 |

所有中間失敗及快照保留，見 [範圍／根因／嘗試](UC135-137.md)。父工作 RED unit 3 failed／64 passed，SQL 3 failed／7 passed；component 的多輪 RED／GREEN 不覆寫。初次 sidecar TEMP EPERM 為 collection 前 harness failure，兩個 runner action label 誤派成額外 focused tests 亦按實際 commands 記錄，不把它們當成 snapshot／format 成功。原 2076 unit、4 pass／5 fail 回歸、前批 2497 unit 或 UC155 的 76 unit／6 SQL 皆保持各自歷史，沒有累計成本輪結果。

Run `cosec-20261023-clients-d20c646a` 經完整 container／實際路徑／TCP system identity gate 後才建立 client、套用 50 個既有 schema migrations 及 fixtures；沒有 app seed／SLA foundation。RED／GREEN 共 20 例精確 IDs 清理回讀 0，最後業務表 0；容器／憑證已移除，313 個原有容器全部保留。各目標及每次 attempt identity receipts 在 db/；無真外發或 provider 行為。

[驗收 CSV](acceptance-results.csv) 保留原 184 列：35 F／15 R／100 UC／34 LA；全部 original／historical／relations／native 欄位不變。本輪只追加 UC135–137、F19、R22、R23 的本機 PARTIAL_SCOPED slice，六批舊 evidence sets hash 不變。原生仍 **70 BLOCKED／114 NOT_RUN／0 pass，NO_GO**。

沒有 push、merge、deploy、正式 migration／資料／帳戶／權限變更。詳見 [blockers](blockers.md)。若需回復，以普通新 commit revert 本 source candidate，保留歷史及 RED 證據；這不授權 production rollback。後續可依原計劃核對另一個尚未覆蓋的本機情境，原生部分繼續等獲准同版 target 及角色。
