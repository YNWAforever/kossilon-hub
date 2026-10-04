# R01 Phase A 實際建立結果及下一步

## 已批准並完成的資源操作

使用者回覆 `approve`，授權原 request SHA256 `47770d20a4aa73bfb7ba17618c1b5dfc0ff6548abf8042b4575a2c38f6ab6e1b` 的 Phase A。2026-10-04 09:59:54 HKT（01:59:54 UTC）Neon 建立 `br-fragrant-sunset-aosoylhr` / `kossilon-r01-staging-20261004`，project `red-morning-00331124`，parent `br-muddy-mountain-aov8bbku`。唯一 create 使用 `no_compute:true`；初始 init、後續 GET ready。

五項 post-operation metadata 讀取確認 ready、non-default、0 endpoint、0 compute、database `neondb`。原四 branch 身份及原 endpoint `ep-patient-block-aoxmgw78` / production binding 相同；未更改 default 或備份。provider 回傳 parent LSN `0/628F120`、parent_timestamp `2026-10-03T12:23:35Z`，不能把建立時間當資料快照寫入時間。

[新 immutable receipt](../../evidence/2026-10-04-r01-staging-created.json) 記錄實際結果；原 [request](request.json) 及 [not_run template](acceptance-template.json) 原封保留。Raw provider results 及 hashes 留在 `.worktrees/r01-phase-a-execution-20261004`；不包含 connection string 或 secret。

## 新差異與驗收界線

新 child 的 Auth config/trusted-domains/OAuth management GET 全部回覆 HTTP404 / integration not enabled。這只核實管理層目前未啟用；沒有查 Auth 資料表、users、roles 或 schema/ledger，不能宣稱資料不存在或已完成隔離登入。Phase A 複製敏感正式資料及角色的授權範圍不變。

R01 候選仍 `257fb9d0be17525a305f38bd26001ad8fa45deb8` / PR124，fresh exact-head5checksSUCCESS，base/live `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`。完整 source main `0f509e8f0913a3931a14a1bdeba317b7dca2ad1e` 的 schema不可帶進hotfix。R01 deployed SBOM、historical core、fresh Auth 與 R03 native scheduler artifact/ticks 均未驗。原50UAT維持19historicalLOCALONLY／31blocked／0newgenuine；正式 NO_GO。

## Phase B1 具體審閱包（未批准、未執行）

[Compute request](phase-b1-compute-request.json) 綁定實際 child ID，提議單一 RW endpoint 固定0.25CU、300秒scale-to-zero、passwordless=false、pooler=false，region承襲來源 `aws-ap-southeast-1`。只允許另行批准的 compute 建立及 [catalog SELECT](phase-b1-catalog-inventory.sql)；新 endpoint ID 現為 null。SQL只讀系統catalog／principal屬性／relation-column metadata，不取客戶或文件內容。這是初步inventory，不是完整physical contract或資料保留驗收。

啟動前重核 branch/non-default/無既有RWendpoint及 Auth 管理狀態，若 Auth 已啟用或 provider狀態不明即停供owner審查。Compute會產生成本，且角色密碼／Auth rows可能隨clone保存。observer即使是privileged也只能執行本次明示SELECT，不能當 restricted app-role。SQL reader、app-role/grants、Auth/protected origin/R2/env/deploy、scheduler及外發各自保持 scope。官方 [compute文件](https://neon.com/docs/manage/endpoints) 說明只有compute才能由client連接branch；metadata ready不是DB連線驗收。

unknown create先GET核對，不盲目重送。失敗停止讀取並保留新資源／receipt；刪除、restore、reset、正式endpoint移動不在B1。任何需要suspend的回復操作也要綁定本次實際新endpoint及適用批准。

## Owner／下一步

- DB/Release：批准精確B1request/hash及bounded catalog read；之後取得完整historical catalog/ledger及restricted-role有效grants審閱包，保留普通migrator divergent-history拒絕。
- Auth/QA：existing Neon Auth branch-specific integration/callback/provider配置、五controlled identities及兩client scopes，secret store交付；本輪404不能冒充fresh Auth PASS。
- Release/Storage：獨立受保護Vercel project/origin及R2、candidate build/install SBOM/hash與old-schema read-only core，部署另有精確批准。
- Ops/DB/Data：R03七logical owners/sole DDL freeze/hosted restore/external contract、scheduler exact artifact/唯一owner及三次真tick。

Rollback：Phase A目前保留no-compute child；沒有SQL、migration、Auth、角色、部署、cron、send或invite寫入。本輪resource verification PASS只能結束Phase A，不能結束F21或任一genuine UAT。
