# UC186：補齊未交案件責任的安全防線

本輪從最新交付 `d2f96c899e30661943b2a59740c2e266a976d9d2`／候選 `9c3afceae55014a024b547d47daf9d7d97e9cc44` 起步；核對 HEAD、父版、worktree、remote及交付後，沒有後續版本或dirty工作需要承接。普通本機候選為 `4e5b4532091d125d79ca19244a0699f26832166a`。沒有 reset、覆蓋其他worktree、push、merge或deploy。

[核心流程覆蓋表](COVERAGE.md) 先按原184列及各批實際證據區分歷史本機通過、本機缺口、原生必要關卡。沒有猜下一個UC或以換付款數字增加測試。所選原UC186／R26／F08為P1：Admin離職交接前必須知道全部未交案件／覆核責任；本輪有限驗收是責任漏列與不安全停用，**不是完整合法轉交功能或原UAT完成**。

## 已重現與最小修補

- **真SQL RED**：正常 incorporation `createCase`建立未完成註冊後，Admin roster／preview均顯示0未交件；停用command成功提交，合成Staff的user/profile停用、revision由1升2並產生audit。見 `db/test-red.txt`、`db/UC186-red.jsonl`，沒有以toast或fixture label推斷成功。
- **UI RED**：註冊／公司變更責任都連到年報詳情，2 failed／3 passed，見 `focus-red.txt`。此前綠色UI只證明mock RPC邊界。
- 根因：Admin三個入口只計年報／work_items，正常註冊未建work item。現以一個SQL scope在roster、preview與寫入前guard同時計年報owner/reviewer、註冊owner、公司變更owner；只排除各業務真正terminal狀態。Work-item既有責任檢查保留。
- Preview回傳case type，詳情連往正確業務路由。超過100件明示未列全；工作隊列不再被描述成完整交接範圍。原last-Admin、current identity、access revision及advisory lock保持。

產品變更只在 `src/features/admin/repository.ts`、`types.ts`、`production-staff-admin.tsx`；另有對應component regression、一個opt-in SQL測試與DB registry登記，共6個source檔案。沒有migration、新權限、真實Auth帳戶、訊息、付款或交件。

## 本輪結果、歷史及NOT_RUN

| 層級 | 本輪實際結果 | 證據／邊界 |
| --- | --- | --- |
| 最終相關unit/component | **28 passed／7 files** | `targeted-accepted2.txt`；mock RPC/Auth，不是原生UI或瀏覽器驗收 |
| 最終SQL | **1 passed／1 file、同一多階段旅程** | `db/test-green-r4.txt`及`db/UC186-green-r4.jsonl`；注入session＋真SQL／disposable superuser |
| Typecheck | exit0 | `typecheck-hardened.json` |
| Lint | full exit0＋最後DB測試focused exit0；既有work-queue Fast Refresh warning保留 | `lint-accepted2.*`、`lintTest-hardened.*` |
| Build | exit0，Cloudflare module／demo auth false | `build-accepted2.*`；沒有部署或啟動原生runtime |
| 完整unit、browser、原生Auth/HTTP/RLS、provider | **NOT_RUN本輪／原缺口BLOCKED** | 歷史2768、前批25／SQL1沒有套成本輪結果 |

逐次SQL記錄：red失敗（真產品缺陷）；green失敗（terminal控制fixture缺company/timestamp，違反既有DB constraint）；green-r2通過；green-r3通過最終格式；green-r4通過最後hard assertion。沒有累計成5個不同測試或改寫失敗。`test-red.snapshot`／`runner-red.snapshot`、`test-green.snapshot`／`runner-green.snapshot`及`test-green-r3.snapshot`保留各版本。Lint首次6個格式錯誤亦保留；以repo ESLint限定修正repository，沒有改業務條件。

完整SQL驗收包含：真createCase且沒有工作投影；單一註冊及corporate-only／zero-work時，停用、移隊、轉Client及重試均拒絕；受影響user/profile完整JSON、xmin及audit不變；年報reviewer與跨業務owner scope；Cancelled／Completed排除；合法terminal的**合成transaction正向控制隨即rollback**，不是實際完成／交接宣告；角色拒絕、舊revision409、last-Admin regression；104宗總數、100宗穩定預覽及truncated標記；獨立connection回讀。外發fetch為0。

本輪review五項驗收缺口已修正：corporate-only反例、100件邊界／誤導提示、soft assertion、低資源／pre-test失敗清理、SQL／shutdown時間界限。最後一個分行soft call亦改hard並重跑SQL。reviewer只作靜態覆核，沒有替代runtime。低RAM cleanup／abort timeout故障沒有強制注入；不把靜態可處理寫成已執行故障演練。見 `review.json`。

## 隔離、版本及證據完整性

使用每slot重新核實的owned container，固定已安裝image `sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232`、Docker desktop-linux、loopback動態port、512MiB／1CPU／1GiB tmpfs、無shared mounts。各target在app import/client/fixture前核對metadata、SCRAM與實際server/DB/user身份；新空DB套現有50migration，來源hash於migration前後、test前後綁定。沒有seed正式資料或改scan/tick。

Run為 `cosec-20261024-handover-657a8815`；精確container/system IDs、ports與資料IDs見 `db/provision-*.json`、各journey planned/created records。red、green、green-r2、green-r3、green-r4均在client closure、exact DB inventory及完整public投影核對後dispose；credential files已清除，沒有SQL刪immutable audit或動其他container。兩次RAM gate（2,428,698,624／2,874,380,288 bytes <3GiB）在provision前拒絕，沒有target或寫入；保留失敗時讀值。Launch門檻未降低；只允許已核實owned cleanup免新測試headroom，仍嚴格核身份／inventory。

669個source/config/runbook檔案由最終Git blobs核對。unit/build之後唯一變更是**被unit/build排除的DB測試**一個soft→hard assertion；其他668檔案完全不變。最後fixture另跑完整typecheck、focused lint及green-r4真SQL，沒有宣稱unit/build曾執行最後fixture，也沒有為此重跑無關檢查。`source-accepted2-before.json`、`source-post-checks.json`、`source-candidate.json`與SQL fingerprints揭示此差異。

18批舊證據／2,534個manifested files原bytes不變，原184列（35F／15R／100UC／34LA）與F08／LA26歷史fail及原關聯保留；CSV只附加UC186 scoped結果。Native仍70BLOCKED／114NOT_RUN／0PASS，NO_GO。最終main唯讀核對見remote-final.json，舊production SHA未接觸。Graph metadata逾時後沒有重試先前遭拒的私有indexing。

## 距離員工可完成日常工作，仍欠的必要關卡

1. **本機業務閉環**：完整合法owner/reviewer交接command、跨業務交接正向審計，以及新建案／指派對停用的並發保護仍未完成。本輪只是拒絕遺漏責任，不能稱UC186全通。
2. **同版原生身份與權限**：實際Auth/session、Admin/Manager/Staff/Client及跨team隔離、HTTP error、app-role/RLS、撤權後舊session／cache拒絕。
3. **一條真員工旅程**：Today找到下一事→正確公司／案件→安全文件／付款→明確readiness→授權操作→API、獨立資料回讀、返回及reload一致，含空態、錯誤、重試、並發、取消。Mock／demo及本機SQL不能替代。
4. **可安全運作的環境**：同版artifact／依賴安全／DB catalog相容、核准calendar、真scheduler freshness、可重現backup/storage recovery及代表性效能／可及性。現有local restore時間不是正式RTO/RPO。
5. **外部步驟的可核對閉環**：如日常工作包括掃描、通訊或交件，需要受控真provider／destination／receipt驗收及個別授權；未接通時只能明示blocked或人工接手，不宣稱已送達／交件。

具體環境、角色、流程、建議用量、清理及待批操作已列 [NATIVE-PLAN.md](NATIVE-PLAN.md)。只準備，未建立正式資源、登入原生站或執行外發。回復候選可用普通新commit revert，保留原始證據，不改寫已發布歷史。
