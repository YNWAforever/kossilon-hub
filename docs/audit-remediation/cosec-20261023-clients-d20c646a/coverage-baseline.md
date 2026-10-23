# UC135–137：原始範圍及既有覆蓋

本輪開始 HEAD `1b8dffc256b934ed11864a07883c80d8de5f8749`，branch `codex/cosec-20261023`，origin `https://github.com/YNWAforever/kossilon-hub.git`，工作區乾淨。遠端 main 只讀核實仍為 `1c57a67213af72bff8d776694e6ed8c986b921db`。production 舊 SHA 僅作使用者提供的歷史，不接觸 production 或借用舊 runtime 結果。

| 原 ID | 原條件及預期 | 開始時實際覆蓋／缺口 |
| --- | --- | --- |
| UC135 | Admin／clients；空必填、非法 CR／BR、正常值；逐欄修正，焦點到第一錯誤、文字對欄位，只建立一次 | client-form-dialog 原 2 項 malformed CR／BR component；沒有完整必填修正、焦點與提交恢復驗收。server schema 的三個文字必填僅 min(1)，空白可穿過 |
| UC136 | 已有同 CR／BR；指出重複欄位、不清空表單、無重複 row | errors unit 已映射 companies_cr_number_key／companies_br_number_key；舊 repository tests 有重複拒絕，但使用固定 seed IDs／TEST-CR 等與 prefix cleanup，沒有本輪新隔離 identities／normalized race／retry snapshot |
| UC137 | 貼上 `12345678-000-07-27-A`；按現行 normalize 規格接受，儲存後回讀標準 BR | identifiers unit 已涵蓋完整 certificate、大小寫及空格；後端 validator 已使用 normalizeBrNumber。原 CSV 仍 NOT_RUN，缺本輪 command→SQL→獨立連線回讀及 renewal-suffix duplicate 證據 |

不執行舊固定 seed／prefix cleanup 的 SQL tests，不用 app seed 補前置。新增 create-recovery SQL 檔只有新 run opt-ins 才啟動，每例自己的 team／users／identifier／company tree，精確回讀後清理；cleanup 失敗會停後續 fixture writes。

沿用既有識別碼規格：完整 BR certificate 捨棄換證期限及 check character，保留 8-digit file number 和明確 branch number；沒有改成新的 unicode／branch 猜測規則。CR／BR 資料庫唯一約束、constraint-to-field mapping 及 repository transaction 均保持原版。

為直接驗收同一 production command，將既有 create handler 內容抽成 `createClientForActor`，並匯出同一 schema；production handler 仍經原 Auth／validator，沒有新 endpoint 或權限擴張。這個接縫建立後先跑回歸：targeted 3 failed／64 passed；新隔離 SQL 3 failed／7 passed，三個 whitespace-only 欄位確實寫入 company／contact／secretary／client_created timeline。修補只在 create schema 的三欄 trim 後 min(1)。所有原始 RED、讀回 row IDs 與 snapshots 保留；未藉修改 DB constraint 或放寬期望使測試通過。

codebase-memory 圖譜 index／私有程式上傳在前批被自動審核拒絕。本輪不重試或繞過該拒絕，使用已知本機來源與獲准 fallback。資料文件是驗收輸入，授權以使用者訊息為準；沒有 push／merge／deploy／真外發。
