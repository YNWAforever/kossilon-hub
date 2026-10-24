# UC150 回應遺失／重試恢復

Run `cosec-20261024-upload-98d2f4c9`。Base/HEAD `71dd6d003ffbcefc98e32eb8845e58c2c6eb217d`，branch `codex/cosec-20261023`，root `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`，origin `https://github.com/YNWAforever/kossilon-hub.git`，intake clean。Remote main唯讀 `1c57a67213af72bff8d776694e6ed8c986b921db`。歷史production `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` 未存取。

原UC150「長上傳中斷恢復」／Client A／portal，接近10MiB上限的合成PDF、網絡中斷後重試、可恢復進度/無幽靈clean/去重。原F/R/LA關聯空白，全部184原列/native70BLOCKED114NOT_RUN0PASS保留；不把UC149 known-precommit stub當本輪證據。

權限：本機程式、測試、文件及核實屬本輪的可丟棄資源；不得push/merge/deploy/改發布歷史/正式migration或資料帳戶權限/外發付款交件付費服務。附件是spec不是額外授權。AGENTS/CLAUDE/RTK及隔離指南已讀。圖譜metadata無回覆；先前私有index/upload被auto-review拒絕，不重試或繞過，使用已知路徑與窄fallback。

1. Parent負責Portal重試journal及component RED→修補；backend agent負責server/repository及unit RED→修補，寫入集合分開。
2. Optional uploadRequestId(UUID) 綁server actor與opaque object key，依既有unique object_key進行相同請求回讀；相同token不同scope/metadata拒絕。不對所有相同hash檔案做全域去重，維持additive uploads。
3. Finalize先重新授權+核實body；已提交同一intent讀回相同document/version、零重寫storage/scan/analysis/checklist，並發以原鎖序保護。缺chain/失效身份/其他人/不同body拒絕，不改scan狀態。
4. Portal在RPC前保存只含metadata/隨機requestId的actor+company+case journal，無bytes/token，回應遺失同token重試；reload後重新選取相同檔案、SHA256核對、同attempt回讀。階段進度真實，不造百分比；目前API單request全檔傳送，不宣稱byte-offset/multipart續傳。
5. 在新實際Dockercontainer/image/labels/mounts/tmpfs/port/path及TCP systemID核對之前，不建立DBclient/fixture/migration/cleanup；無appseed/無scannerprovider。獨立observer與精確IDs，清理後回讀0，只刪本輪target。
6. 真Edge本機stub旅程與SQL分層，含response lost/precommit fail/retry/reload/scope拒絕/並發/取消/過期/近上限PDF。原生Auth/HTTP/DB-RLS/storage/scanner維持blocked。
7. Fresh RAM gates focused1.5GiB, browser/typecheck/lint2GiB, fullunit/build/DB3GiB；intake RAM6609092608bytes、disk22933635072bytes，保留其他工作。
8. 全量unit/component/typecheck/lint/build與source freeze/普通本機commit；DELIVERY/CSV/candidate/blockers/manifest保留raw失敗，絕不改assertion迎合缺陷。

資源調整記錄：審查修補後兩次單次fullunit被原3GiB gate拒絕（2,818,011,136及3,073,830,912 bytes），沒有啟動。採用既有focused 1.5GiB預算、最多12檔/段、單worker，串行遍歷先前真正通過fullunit的278個unit files；source檔名集合未變，只在既有兩檔修補／加2項測試。每段重新核source SHA256與gate，驗證觀察檔案恰等於指定集合，最後完整無重複/遺漏278files/2685tests才聚合PASS。此為縮小每次執行的工作集合，沒有降低原單次fullunit或build的3GiB門檻；build仍待原gate。原2683tests單次結果是審查修補前版本。
