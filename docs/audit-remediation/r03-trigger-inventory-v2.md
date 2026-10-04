# R03：trigger 權限 metadata v2

原 `scripts/audit-app-role-inventory.sql` 保留原 bytes/hash `4be890…`。
新查詢為 `scripts/audit-app-role-inventory-v2.sql`，version=2，SHA256：
`02a89e162623319b4c1435acc46d9020a570a22281cd01252c43d0b2cc87a463`。
舊 request／批准不自動涵蓋 v2；執行前須建立新的 exact-hash scope。

## 重現及變更

本機 PG18 fixture：app 直接 UPDATE 私有表被 `42501` 拒絕，routine 的直接
EXECUTE=false；app UPDATE 已授權表時，既有 SECURITY DEFINER trigger 仍修改
私有 fixture。v1 只有 routine facts，沒有 trigger linkage；新合約先 RED。
這是 inventory 的證據盲點，沒有聲稱已重現正式環境的越權。

v2 在原 metadata SELECT 加入 user relations 的 trigger、function linkage／owner、
security_definer、直接 EXECUTE/grantable、raw `tgenabled`／`tgtype`、internal／
parent／deferred／WHEN 是否存在，以及 session_replication_role。
包括 disabled、replica、always、invoker 及 internal facts；不按 EXECUTE=false
或單一 enabled 值判斷安全／實際可達。function 可位於不同 schema。

查詢不執行 trigger/routine，不輸出 function body、trigger args、WHEN expression
或業務 rows。測試中的 trigger invocation 是獨立本機 fixture 動作，整個 fixture
transaction rollback 並核對 role/schema 零殘留。原 v1 合約及原 50 UAT 保留。

## Operator 界線

仍須批准 target/build/query/hash/TLS/freeze/private credential／compute scope。
實際 app-role probe 必須獨立新登入、current_user=session_user，使用
`BEGIN READ ONLY; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';`
執行 exact SELECT 後 `ROLLBACK`。owner/SET ROLE observation 不能代替 app LOGIN。
metadata 結果保持 **not_assessed／NO_GO**；不能代替 full physical contracts、
incoming-role/admin/SET paths、global extension/FDW/default ACL、完整 trigger 邏輯、
tenant/provider journeys 或 fresh Auth 驗收。未知結果不盲目 retry。

trigger 的事件與 function 關係見
[PostgreSQL 18 CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html)。
revoked EXECUTE 後仍觸發的結論來自本次實際 PG fixture；沒有把官方文件未聲稱的
runtime 權限檢查政策當成保證。

[本機實際回條](evidence/2026-10-05-r03-trigger-inventory.json)分開記錄 focused PG18、
完整測試、CI 和 hosted 狀態；本地 PASS 不提升正式 release/UAT 狀態。

## 本次驗證

- PG18 focused：RED 15 PASS／3 FAIL／0 SKIP → GREEN 18 PASS／0 FAIL／0 SKIP。
- Linux Node22.23.2／Bun1.4.2／PG18.6：242 files，2320 PASS／0 FAIL／0 SKIP；
  兩個獨立 npm/Bun installation tree 的 lint/typecheck 通過，兩個 lock audit 0 vulnerabilities。
- 原 local demo/parser browser：12 PASS／0 FAIL／0 SKIP，僅屬本機合約。
- Windows Node22.23.3 build 及 built scheduler hook 通過；dev import gate 兩次均在
  原 30 秒啟動期限 FAIL（第二次固定 child Node PATH）。沒有放寬 gate 或把失敗改記 PASS。
- 原 Linux Node22／24 CI 的所有 gates 仍是 merge 前條件。現有 work-queue Fast Refresh
  warning 保留；原 50 UAT bytes 不變，19 歷史 LOCAL_ONLY／31 blocked／0 新 genuine PASS。

本次沒有 hosted query、role/grant、migration、部署、外發或 invite。v2 仍須新的
exact-hash scope、owner private service／TLS 引用、DDL/GRANT freeze 及 fresh restricted LOGIN。
