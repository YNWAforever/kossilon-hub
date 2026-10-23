# R22：真正瀏覽器縮放與本機唯讀旅程

範圍是既有 demo 的 Admin／Staff UI，不建立帳戶、DB client、業務 fixture、付款、訊息或交件。原生 Auth／HTTP／DB roundtrip／client-record journey 仍未驗收。本輪沒有改產品 runtime、依賴或 schema。

## 固定驗收條件

- full390：從登入、總覽、客戶 unavailable 邊界、年報空搜尋及指定案件，到 reload、返回、Admin 唯讀用戶管理／Staff 直接路由拒絕，再登出；全程 CSS viewport 390×844，不在中途切到640。
- desktop100：同一路徑作控制組；固定原生視窗1304×992，內容1280×900，device scale 強制1；Playwright viewport 為null。
- desktop200：相同原生視窗，透過全新profile的 `partition.default_zoom_level.x` 設為 `log(2)/log(1.2)`；內容640×450，DPR2。每個checkpoint直接讀取CDP `Page.getLayoutMetrics().cssVisualViewport.zoom`，要求2；pinch scale1、root/body CSS zoom1且transform none。不是 `setViewportSize(640)`、CSS zoom、pinch或deviceScaleFactor2。
- 每個角色在各組有8個checkpoint：overview、client-unavailable、empty-search、filtered-board、case、reload、return、users／denial。每步保存幾何與zoom讀值、截圖、trace；最後保存請求清單及page errors。
- 真Tab／Shift+Tab／Enter／Escape；drawer逐一對照DOM可見tab stops，正反各超過完整一圈，驗證實際移動及wrap。焦點外觀用同一控制項真Tab離開後的樣式作對照，避免把裝飾shadow誤當focus ring。Escape後回原trigger。
- 關鍵標題、owner、payment、交件／回條、備註及返回檢查內層裁切、文字寬度、viewport及中心點遮擋。唯讀disabled Button的pointer-events:none須精確處理，見下文。

Chromium原始碼說明此設定為按partition key儲存的dictionary，空relative path的key是x，並將設定傳至HostZoomMap：[ChromeZoomLevelPrefs](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc)。本輪是否生效以實際runtime／CDP讀值為準，並未只憑設定存在宣稱成功。

## 環境守門

`run-browser.mjs` 僅在指定checkout啟動，拒絕非example的.env檔；子程序只繼承Windows執行所需env白名單，無DB／原生Auth／provider設定。先bind檢查5180空閒，Playwright禁止重用既有服務，再由Vite以指定checkout及loopback啟動。`server-identity-*.json` 記錄監聽者及實際command line；程序退出後再讀回port。每個測試使用自己的新profile，未讀取使用者既有profile。

瀏覽器HTTP只准自有origin的GET／HEAD，其他請求abort並令測試失敗；WebSocket只准同一loopback port的Vite HMR。沒有攔截後偽造產品response。這些是browser層守門，不宣稱驗證了真provider或server端網絡隔離。DemoUnavailable維持原樣，沒有編造client record來令旅程通過。

## 失敗、檢視及處置

1. `zoom-probe.txt`：sandbox內Edge啟動崩潰，保留完整log；主機層以全新profile／空白loopback頁重驗。不是產品失敗。
2. `zoom-probe-host.txt/json`：第一版將default_zoom_level寫成數值；量測兩組都為100%，不算zoom pass。`zoom-probe-v2.*` 修正dictionary後，在相同1280×900 outer window量得1256→628 CSS width、DPR1→2、CDP zoom1→2。保留第一版檔案與數據。
3. `browser-first.txt`：三組都在新fixture setup因重複tracing.start失敗。Playwright已自動開始trace；移除手動重複啟動，改用config trace:on；原log／trace／source snapshot保存。不是產品RED。
4. `lint-first.txt`：新Playwrightfixture callback參數名use被React hooks lint當成hook。改為providePage，不關閉lint規則。
5. `browser-second.txt`：三組通過，但獨立檢視指出舊helper的focus shadow／內層裁切及drawer traversal驗收盲點。只保留為中間證據，最後結果使用補強版本。
6. `browser-final.txt`：補強版本三組都在disabled交件按鈕中心hit-test失敗。Trace確定前面的標題／owner／付款已通過；產品Button本身明確使用disabled:pointer-events-none，故elementFromPoint回傳包含該按鈕的panel。截圖顯示按鈕可見。修正測量工具，只在`:disabled`且computed pointerEvents為none、hit確實為其祖先時接納；兄弟overlay仍失敗。不更動產品disabled狀態、不移除clipping／文字／viewport要求，也不為產品缺陷降低期望。

`source-freeze.json`對應第6步前版本；`source-freeze-verified.json`對應verified／reflow執行內容。第二次檢視再指出scrollIntoView可能捲開overflow:hidden內容，以及自身垂直文字裁切；後續加入滾動前hidden／clip祖先檢查及自身scrollHeight檢查，以 `source-freeze-complete.json` 固定最後complete／reflow-complete內容。所有舊來源snapshot、log及trace保留，沒有把前輪成功套到新內容。

獨立檢視的4項要求已加到驗收：focus-specific cue、內層clipping、完整雙向tab order、直接CDP zoom。此檢視是測試證據品質檢查，不是對產品原生可用性的認證。

測量工具仍有界限：中心hit-test只可偵測會參與hit-test的overlay，不能自動證明沒有pointer-events:none的繪製遮擋；截圖另供視覺review。這不是完整視覺、contrast、screen reader或WCAG認證。最後人工檢視代表性截圖的範圍另記於交付，不以自動幾何測量推論所有無障礙要求。

## 截圖捕捉的後續核對

complete／reflow-complete的5項通過後，人工看圖發現desktop200的Playwright fullPage圖只有640個physical pixels寬，右側被crop。`screenshot-diagnostic.json`及原圖保留。`zoom-probe-cdp.*` 在相同視窗的空白loopback頁對照，CDP未設clip的原生surface在100%與200%均為1256×808 pixels；Playwright截圖則為1256×808及628×404。這是捕捉工具座標／clip問題，不能拿裁切圖當完整視覺證據。

最後改為CDP原生viewport捕捉，斷言PNG寬高等於CSS viewport乘zoom；case／reload另以CSS content size乘zoom的clip捕捉fullpage。`source-freeze-capture.json`固定這次僅改捕捉的來源，新矩陣以native-capture重跑。390及200%的Admin case viewport與200% fullpage已目視核對，右側完整；最後200% viewport為1280×900、fullpage寬1280。兩組原有reflow不使用新spec，其依賴的原spec／helper／base config未再變動，由freeze及Git差異核實。
