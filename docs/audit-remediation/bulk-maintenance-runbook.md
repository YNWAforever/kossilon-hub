# 日常批量維護（T18）

同一 selection snapshot／preview／durable job 支援客戶 owner/team、文件所屬案件分派、逐筆原因的退回草稿、文件 metadata 清單、追件草稿及付款核對清單。現有四角色政策不變；批量工具限當前 Admin/Manager。

## 操作與事實

- 預覽固定版本及範圍；批准建立 job。每筆重新核對原批准者、可見範圍、版本、鎖定及單筆 domain service。
- 文件分派會改其所屬案件及既有 child work。無案件映射者先人工映射；同案多項於首筆改動後會衝突，需要重新預覽。
- 客戶 team 移動須先核對 owner/team 及未結案件／工作的責任一致性；工具不自動改整個團隊或擴權。
- 退回及追件只保存草稿。退回原因逐筆填；Received、未知 checklist、無持久化聯絡人、fixture/historical、結案或既有 unknown 派送不會批量追。真正批准仍用當前版本單筆流程／既有 outbox。
- 文件清單只含 metadata，標明未检查 storage、未知安全或 quarantine；不包含 object key、bytes 或下載權限。付款清單不批准入賬，不改 paid_at。CSV／下載不等於交件。
- 已保存工作可逐頁看部分結果及 CSV。取消只影響未開始項；成功項保留。只重試有 PostgreSQL rollback 證據的40001/40P01；unknown 不自動重排，先由 owner 核對 domain audit／保存結果。

## Schema／rollback（尚未正式套用）

0079 在既有三表擴 resource CHECK，並於 preview/job 加 action_key，既有紀錄保留 assignment。payload 仍用原 JSON 欄，未新增外部派送隊列；scheduler activation 未改。

正式操作前確認精確 project/branch/database、source47 與舊66 ledger/實體 schema 的部署順序、backup/recovery point及約束名稱；使用既有 guarded migration runner，不能改 ledger 冒充已套用。SQL交易失敗回滾。

程式 rollback 前先由 Operations 暫停 job worker，核對新 resource/action 的 jobs及逐筆結果；保存所有紀錄，不可刪資料／drop新增欄去遷就舊 dispatcher。優先 roll forward；正式 SQL、scheduler 或部署均需對該 release 的授權。

## 驗證限制

T18 source3226db6：真隔離 Postgres 39 bulk tests、53畫面/convention tests通過；template／資料版本、跨隊、逐筆原因、取消／resume／retry契約已覆蓋。全 PR09 CI/review 於 T19 後完成。真 Auth、WOZTELL、R2/scanner及 native ticks 仍未驗證；本地 fixture／stub 不是正式收件或付款證明。
