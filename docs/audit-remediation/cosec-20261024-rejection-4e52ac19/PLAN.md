# UC149 退回原因與補傳 — 4e52ac19

基線 `6f29c4068fcbbaa2197efdf0b8969777b78f47c5`，branch `codex/cosec-20261023`，root `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`，origin `https://github.com/YNWAforever/kossilon-hub.git`，intake clean。Remote main 唯讀仍 `1c57a67213af72bff8d776694e6ed8c986b921db`；歷史production `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` 不存取。本機修改與獲核實的可丟棄測試資源沿用授權；不push/merge/deploy，不改正式資料/帳戶/權限，不外發/付款/交件。

原UC149無F/R/LA關聯，保留空白與原始JSON；角色Reviewer+Client，缺簽名/不可讀文件→選理由+文字退回→Client補傳，預期要求具體、新文件另審、舊review不沿用。184原列與native70BLOCKED/114NOT_RUN/0PASS維持不變，只追加本機分層證據。

選擇理由：UC164的非法/不存在ID已在UC160含相近覆蓋；UC166已有schema拒絕tests，UC134需要已核准calendar identity。UC149欠缺退回理由至Client的讀取/UI鏈與補傳後重新讀取狀態。已讀版本/掃描/授權/Portal既有tests；不能把相鄰unit當完整scenario。

圖譜metadata再次無回應，已終止有界請求。先前index/upload被auto-review拒絕，不重試或繞過；使用已知路徑及窄範圍fallback查證。AGENTS/Lovable歷史規則及RTK已讀。附件作spec，不增加本輪權限。

1. 先以component及repository regression重現缺口，保留RED原始log/source。只修實證root cause；不重新實作已有正確版本/掃描邏輯。
2. 對Client只投影當前被退回版本、同公司/案件的review reason，禁止傳送內部checklist備註或歷史版本理由。驗證其他公司/版本不洩漏。
3. 驗證Client補傳/重試、pending/錯誤/空態、取消/離開、重複/並發、返回/reload及資料回讀。stub runtime不等於原生Auth/HTTP/provider或DB。
4. 如需SQL，先實際container/image/labels/mounts/port/path及TCP server system ID gate，再client/fixture/migrations；新run精確IDs、獨立observer、exact cleanup。只用已安裝pinned image、無app seed/無真scanner。
5. 按影響跑unit/component/typecheck/lint/build；fresh resource gates：focused1.5GiB、browser/typecheck/lint2GiB、fullunit/build/DB3GiB。Intake freeRAM5,048,045,568 bytes；disk23,192,215,552 bytes，不停止其他工作。
6. 交付DELIVERY、acceptanceCSV、candidate、blockers、byte manifests。原生/正式缺口保持NO_GO；只ordinary local commits，保留舊raw evidence。
