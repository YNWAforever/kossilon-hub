# PR10：T20／T21 獨立覆核與修正

覆核範圍：`b94a54d419e86ad336179f56e539bdac2b988980..309231aaf0e758036d026eb9e4fad904b138b81a`。一名 fresh-context reviewer；沒有第二輪覆核。Critical：0；Important：5，全部接納；Minor：0。Reviewer 只作 source／in-memory 重現，實際 Node24.18.0，沒有執行 DB tests；不可當作 Node22 CI 證據。

| Important                                   | 修正與回歸                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portal 跨帳戶快取可能洩露 metadata          | Portal 案件、文件 query key 包含完整 actor scope；verified root loader 在帳戶／role／team／active／登出切換時 cancel 並 clear QueryClient。非 next-page 的權限 refetch 失敗不再顯示舊文件。實際 Portal A→B Forbidden interaction 不再顯示 A 的公司／檔名。 |
| 模板背景 refetch 靜默覆蓋另一 Admin         | editor 草稿、arrays、revision 綁定同一 baseline；未改欄位 blur 不送寫入。另一 Admin refetch 後自己的 draft 仍帶原 revision，409 保留輸入；只有自身成功 write 或明確放棄／reload 才更新 baseline。                                                          |
| 搜尋隱藏選項但仍提交舊 ID／version          | Staff／Document 搜尋變更即清空 parent selection；文件同步清空 selected version。actor／case／category scope 變更亦清空。初始不在頁內的既有值顯示明確 unavailable option。server 每次仍驗證 current authority／version。                                    |
| board／bulk staff 截斷為200無法找到其餘人員 | 兩處加入 server 全 scope 搜尋，明示最多200；bulk adapter 傳 q／limit 並保留重新驗證 Admin／Manager team gate。改 bulk 搜尋清空選項及 preview；board 搜尋保留可見的既有 filter option。                                                                     |
| Today／Clients 下一頁失敗抹去已載入列表     | 共用 retained-page hook 只在同一 actor／filter／sort scope 保留最近成功頁。失敗 cursor 有明確 retry，pending／error 禁用下一頁，換 scope 不保留旧資料。                                                                                                    |

修正 source：`4a97955d298d63aefdf02cb79b58f413817f2770`。Actual Node22.23.3 focused：10 files／62 pass／0 fail／0 skip，14.38s；typecheck PASS；lint 0 error／1 原有 warning。

RED 原始 logs 保留在本地 ignored `.worktrees/audit-baseline-20261001/`：`pr10-review-red.log`、`pr10-settings-concurrency-red.log`。第一份包含4個實際 interaction failure及2個尚未建立 helper 的 contract failure；settings 第二份確認錯誤 revision payload，沒有只用 import failure 宣稱 product 重現。GREEN：`pr10-review-green-final.log`。

## 現有 CI 回歸

舊英文 nav／舊 list API 靜態契約更新至要求的 HK labels／private paged endpoint；原安全與 route 行為 assertions 保留。Settings test 明確 await TanStack route `.preload()`，沒有放寬等待時間。原4 files／23 tests GREEN，21.23s。

完整 CI 首輪：225 files，2170 pass／1 fail／0 skip，362.46s。剩餘失敗是舊 scope test 用 seeded case owner 卻假設其必然是 Staff；finding resolution 重新讀取真實 DB profile，owner 若為 Admin 可以合法 resolve。`e09820c` 在 transaction 建立真正 Staff profile 並分派測試案件；原 shared-document denial assertion 保留，transaction rollback，沒有修改 server permission。該實際 Postgres suite43／43 PASS，6.62s。完整重跑結果由 PR10 gates JSON 記錄；首輪失敗 log 保留。

## 尚未能判斷

Reviewer 明確未驗證真 fresh Auth、R2／scanner／OCR／AI／destination receipt、native scheduler、production0082、staging效能／cold cache／platform streaming及完整正式 mobile journey。這些仍是具體 runtime release gates。Demo Chrome及本地 synthetic PG 不取代以上驗收。
