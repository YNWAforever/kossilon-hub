# R01 staging：可審閱建立包（未執行）

## 本次可批准的精確操作

本輪只準備 [request.json](request.json)。Phase A 請求在 Neon `red-morning-00331124`，由 `br-muddy-mountain-aov8bbku` 的當時 HEAD 建立新 `kossilon-r01-staging-20261004`，指定 `no_compute: true`。來源目前只有一個 database `neondb`；provider 回傳的新 branch ID 必須另記，不能以名稱代替身份。請求不包含 SQL、migration、角色、Auth/domain、環境變數、Vercel deploy 或 cron 寫入。

使用者本輪選擇「先準備新 staging 的具體審閱包」。這是本地準備授權；hosted 建立尚未獲批。Phase A 複製正式資料、Auth 設定與角色，需明確批准資料副本及本 request 的 SHA256。新 branch 仍佔用儲存及專案配額；未有 compute 不代表免費或已完成隔離驗收。

安全候選是 PR124 / `257fb9d0be17525a305f38bd26001ad8fa45deb8`，base 為實際 live `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`；本審閱分支的 main 基線為 `f5efd1283d00f02189e51ddf1e287d35a547360d`。候選10個變更檔案均已記錄，migration/domain bytes 與 base 相同。177files/1763PASS 是候選過往本地 fresh source-schema PG18.6 結果，不能當 historical hosted clone PASS。PR124 exact-head CI37103410777 已綠，仍是 dedicated live maintenance base 的 draft；本包不將它 merge 至 main 或部署。

## 操作者順序及驗收

1. DB/Release owner 批准精確 request/hash/來源/新名稱。執行前重新 GET live alias、candidate/CI、來源 branch/default 與名稱清單。live 改變或新名稱已存在即停，重新核對；三個 historical backup 不可復用。
2. 只以 request 的 `phase_a.arguments` 呼叫所列已存在 connector，不能加入 compute、restore、reset、set-default 或其他參數。由 provider 於當時 HEAD 建 branch，事前 observation 不等於 clone 的 snapshot 時間。
3. 保存實際 operation/result。另建 dated receipt，以 [acceptance-template.json](acceptance-template.json) 作欄位契約；記下 UTC、approval/hash、實際 project/parent/new branch ID、name、parent LSN/time、state/default、endpoint inventory 及 raw receipt hashes。原 proposal/template 保持不變。
4. 驗收 ready、指定 parent、non-default、零 endpoint；再 GET 確認原 production/default/三個 backup 身份不變。`no_compute` 是请求值，零 endpoint 必須實際驗證。若 provider 狀態不同或資訊不完整，保留 failed/unknown，停止後續動作。
5. unknown/timeout 不重送 create。先按 project/name/parent/creation time/operation receipt 查明是否已建立，核實 ownership 後才決策；不得把同名既有 branch 當本次成功。
6. Phase A 不建立可用 app/Auth；schema、ledger、角色有效授權、fresh Auth、provider、native tick 全部仍 `not_run`。只有 Phase B 的精確 binding/permission/compute/deploy 包獲適用授權後才啟動。

## Phase B 的具體輸入與隔離

| Owner                  | 已定候選／仍需填的實際 input                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB                     | Phase A 回傳 branch ID；該 branch 的 endpoint；restricted app-role/principal 與逐表有效 grants。不能選 `neondb_owner` 或從 `authenticator` 名稱推斷安全。R01 不跑普通 migrator/seed/ledger 修補；比較 historical physical contracts 和 ledger。R02/R03 全功能 release 另需七 logical owners、sole DDL freeze、restore 及外部批准 policy。                                                   |
| Release                | 提議另建 `kossilon-hub-r01-staging`，team `team_qvzlsFmfCsLkgItSypqHjw3z`。project ID、受保護 staging HTTPS origin、web artifact SHA 現為 null；不能復用正式/既有 preview 的共享 bindings。指定 exact candidate，build 後保存 installed SBOM/lock/build hashes。                                                                                                                            |
| Auth / QA              | 同一既有 Neon Auth 架構的 branch-specific `NEON_AUTH_URL`、新 cookie secret、批准 callback/trusted origin。owner 審查 cloned OAuth/SMTP/email 設定，先不發送。五個既有 controlled identities（Admin/Manager/Staff/Client A/Client B）及兩 client-company scopes，由 secret store 提供測試 credentials；不能邀請或擴權。fresh magic-link/Google 若涉及真 recipient，另需該 flow 明確 scope。 |
| Storage                | 獨立 R2 bucket 與 bucket-scoped `R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME`（optional endpoint），controlled object/hash。不能從正式 bucket 複製私人文件或將14legacy metadata標 clean。                                                                                                                                                                            |
| Channel / scanner / AI | Phase B 初期不配置 WOZTELL、RESEND、scanner/AI 或 handoff transport 的 live credentials/webhooks。未驗功能明示 blocked。缺失 binding 不等於證明零外發；provider 實際配置及 callable paths 仍由 owner 核實。                                                                                                                                                                                 |
| Ops                    | 初期沒有 Vercel cron/Cloudflare trigger/CRON secret，也不呼叫 manual tick。候選沒有 main 的 maintenance-trigger 開關，不能虛構 disable env。R03 需獨立 native scheduler artifact/approved contract、唯一 owner 及三次真 tick，與 R01 web 分開。                                                                                                                                             |

所有 secret 寫入需指定 secret store/environment scope；本包沒有 value/connection string。`VITE_PROVIDER_MODE=simulated` 只可用於 demo，不能讓 genuine staging 顯示 provider 成功；production build 也拒絕 local mode。Demo 持續 read-only。

## Auth 與 clone 能力核實

[Neon branching](https://neon.com/docs/introduction/branching) 說明 branch writes independent；[Branching Authentication](https://neon.com/docs/auth/branching-authentication) 說明 Auth users/config/roles-related state會隨資料複製，branch-specific endpoint 與 fresh domain login仍需核實，Managed Better Auth需要 read-write endpoint。OAuth credentials會複製；[protected branches](https://neon.com/docs/manage/branches#protected-branch) 的新 role 密碼保護不能套用目前 metadata `protected=false` 的來源。branch/R2 是兩套 storage；Neon 文件關於 Neon Object Storage 的分支能力不能套用 repo 的 R2。

## Acceptance / rollback

Phase B 開始前準備精確 env/permission/deploy diff、target IDs、hash、actual acceptance command 及 rollback。驗收要記候選 installed `@tanstack/react-start`≥1.168.60、`@tanstack/start-server-core`≥1.169.39、`pdfjs-dist`≥6.2.108，fresh Auth/negative scope、舊 historical schema read-only core routes。source locks/CI/既有 session/這份 template 不能當 deployed PASS。

Phase A 失敗/unknown：停止並保留新 branch/receipt 供核對；不自動刪除、reset、restore、移 endpoint、改 default 或還原正式資料。若要求 cleanup，另核實新 ID、無 children/default/bindings/use/compute並取得該精確資源刪除授權。Phase B 失敗：先停新增 staging trigger/dispatch，保留 unknown attempts及證據，使用已驗證安全相容 artifact或forward-fix；不把已知漏洞 aa5 當普通 rollback build。

原50UAT與全部舊 evidence 不改。Phase A 即使成功，只能更新資源建立 receipt；原31blocked、R01/R03 runtime與正式NO_GO需各自真驗收才改。
