# T03 — 資料來源及外發界線

## 已實作

正式公司／案件列表、分頁及 SQL totals 預設排除 `fixture`。Admin 可明確選擇診斷範圍，server 再檢查角色；Staff／Manager 的輸入不能擴大範圍。顯示客戶／測試／歷史／待核對 badge，demo 保持唯讀。

歷史案件可查閱，不產生追件草稿。未知來源亦不產生草稿。既有 claim／cancel suppression 保留，dispatch marker 在 transport 前再次確認公司仍屬 `client`。這不能取代真實收件人授權，亦不證明 provider 已送達。

Ruling：main 的既有 `companies.data_origin` constraint 只有 `client`／`fixture`，但驗收要求歷史資料獨立顯示。0068 在同一欄位增添 `historical`；沒有另加競爭欄位，沒有 UPDATE／seed／reset。代價是正式發佈須批准新增 DDL。未批准前保持 production 不變。

## 唯讀 inventory 及待確認清單

- 正式：`evidence/2026-10-01-live-origin-inventory.json`，aa5 Web／指定 Neon；3 公司全部記為 `client`，每家 1 案，版本 timestamp 保留。4 pending 通知都有 idempotency key，沒有 provider ID；收件人及業務 provenance 尚未驗證，不能據此啟用排程外發。
- 隔離本地：`evidence/2026-10-01-local-origin-inventory.json`，3 個已知 seed fixture，0 outbox；這些分類不能推算到正式庫。
- 三個正式公司 ID：`30000000-0000-0000-0000-000000000001`、`...0002`、`...0003`。全部維持原 `client`；Business data owner 逐家公司提供來源憑證，並確認聯絡人與追件權限。名称、UUID、逾期數或 seed 外貌不構成分類證據。

唯讀 CLI：`node --experimental-strip-types scripts/audit-data-origin.ts`。只讀來源、ID、版本及數量，最多 100 家並明示截斷；不讀訊息內容、電話或電郵。

## 逐筆修復方案（未執行）

每筆先提供 `companyId`、inventory 的完整 `updated_at`、原來源、建議來源、業務憑證、原因、批准人和批准時間。沒有以上資料就保持待核對。正式版本 timestamp 必須保留 Postgres 精度，不能先轉 JavaScript Date 再作版本比較。

1. server 重新核對 active Admin、公司範圍、來源、版本；沒有 current-version 批准就拒絕。
2. dry-run 顯示唯一目標及受影響案件／排程數，不改來源或發訊息。
3. 經另行明確批准後，單筆 transaction 鎖定公司，再執行參數化 compare-and-set；必須恰好 1 筆，0 筆是 stale，不能重試覆寫。
4. 同 transaction 用現有 audit writer 寫前後值、憑證、批准資訊和 correlation ID。先核對來源歷史，不能直接 SQL 修改而漏 audit。
5. `client` 轉非 client 後再次掃描取消 pending；processing 有 dispatch marker 的未知結果只作核對，不能回到 pending。

參數化 SQL 契約（只供 review，尚無批准值）：

```sql
update companies
set data_origin = $4, updated_at = now()
where id = $1::uuid and data_origin = $2
  and updated_at = $3::timestamptz
returning id, data_origin, updated_at;
```

批量修復須等 T13 的共用 domain registry：preview、逐筆授權／version、防重、audit、部分結果及 resume；不能把此 SQL 擴為無限制 UPDATE。

## 0068 演練、部署及 rollback

只在 `kossilon-audit-20261001`／`kossilon_audit` 執行：guarded migrator、重跑 constraint extension、未知 constraint 拒絕及 connection rollback。前後均 3 fixture 公司／0 outbox；原來源保留。新欄位值須與含 suppression 的相容程式一起發佈。

正式0067／0068尚未執行，部署尚未切換。按 schema-reconciliation.md 先暫停實際 scheduler、復原點與 restore 演練、確認 SHA／SQL hash、批准後執行。0068 transaction 失敗會還原原 constraint；已 commit 後如已有 historical 值，不可直接降回兩值。保留安全的 additive constraint，先回滾程式並保持外發暫停，再由資料 owner 審核後續方案。

## 實際驗證界線

真 Postgres：相同 deadline 的 client／fixture／historical 只讓 client 呼叫模擬 transport；claim 後改來源阻止派送；正式 scope 2 案／診斷 scope 3 案；偽似 seed 的 client 保持原分類。這是本地契約驗證，沒有向真實收件人外發。

OPS-04 可記 local-only pass；FLOW-09 完整新客戶流程仍待 T12／T22，不以此局部測試結案。
