# 審計候選版本回復／故障處理

本次只準備runbook，沒有執行正式DB／部署／provider操作。

## 發布前必備紀錄

- 核准Web SHA／Worker SHA／project／branch／DB endpoint／migration IDs＋hash＋physical catalog／R2 prefix／scheduler唯一owner／feature gates／UTC時間。
- 真 recovery point及isolated restore proof，row counts／FK／current document versions／ledger／outboxunknown前後比較。
- 舊版是否兼容擴充schema，舊worker是否可能重派unknown。不能只記「上一版」。

## 發現失敗時

1. 先停止新批次／追件外發trigger；保存maintenance pass、job cursor/item、outbox attempt／unknown、providerreference及version evidence。停止provider動作仍須依現有正式操作授權，不能改寫結果。
2. 不重試unknown send／submission，不刪已送訊息的attempt，不用mockreceipt結案。先用真provider對賬；外部已送訊息不可撤回。
3. SQL transaction內catalog／count／constraint檢查失敗：ROLLBACK整個未commit transaction。保留原migration ledger；不得寫假receipt讓health變綠。
4. 已commit的expand migration：優先部署已核對兼容schema的舊app/worker，保留新增tables／版本／audit／unknown fences。**沒有自動down migration或DROP TABLE方案。** forward repair需另有reviewed SQL＋授權。
5. 已套用import／bulk：停止剩餘chunks，保存per-row outcome／version／idempotency／journal。對已成功列準備可審閱補償preview；不要刪公司、付款、文件或reseeding來復原。failed-only resume仍重新auth/version；unknown先reconcile。
6. 只有確認重大資料損毀且批准incident restore時才還原；先保存recovery point之後的writes／provider receipts並計劃reconciliation。使用documented non-finalizing snapshot操作，不能把production endpoint移到clone只是為了檢查；回復endpoint須明確核對identity及連線影響。

## 再開啟的 gate

同一核准版本／compatible schema／真Auth與document safety／provider gates完整，unknown已對賬，sole native trigger三次真ticks及controlled batch outcomes有證據。再觀察完整工作日。任何缺口在 environment-matrix／CSV保留blocked，不能用manual tick或乾跑通過取代。

## 單feature細節

Schema：schema-reconciliation.md；scheduler：scheduler-runbook.md；文件：document-recovery-runbook.md／document-analysis-runbook.md；付款：payment-evidence-runbook.md；bulk/import：bulk-assignment-runbook.md／bulk-maintenance-runbook.md／nar-import-runbook.md；WhatsApp：whatsapp-runbook.md；handoff：handoff-runbook.md；template：template-version-runbook.md。
