# 同一候選的原生員工旅程：只準備、未執行

狀態 BLOCKED／NO_GO。候選以本批 release-candidate.json 的 source_sha、完整 source manifest 為準；不可把 main、舊 production 或另一 SHA 的站套進來。此計劃沒有授權建立／deploy 任何站、分支、帳戶或服務。

## 環境與角色前置

- 由擁有人提供已批准隔離站 URL、實際 artifact/source SHA、Cloudflare runtime identity、Neon project/branch/database、Auth tenant/branch、storage bucket／queue／scanner sandbox 的非秘密識別。沒有這些便不建立 client 或登入；不在聊天提供 credentials。
- 先唯讀核對部署與 DB applied ledger／physical catalog／權限及依賴安全候選；實際 target 與 root/port/proxy path 必須一致。不能只用 localhost、QA 名稱或成功 build 判定身份。
- 使用合成 Admin、Team A Manager／Staff、Team B Manager／Staff、Client A／B，以及一名停用／未授權控制身份。逐個核對 immutable Auth ID 到 internal profile／team／membership；email 相同不構成綁定。
- Case/data：每隊一間合成公司，年報／註冊／變更各一個 open case、覆核及owner責任；付款應收1,800＋600＋1,200；兩個真實可驗證文件版本；沒有 proof 的欠款；隔離／拒絕文件。精確IDs、object keys及父子關係在執行前manifest登記；不使用正式資料。

## 完整員工旅程與成功門檻

1. Staff A 真登入→Today 找下一件事→看清期限／首要文件或付款 blocker→開正確案件。Manager A 看同一 team 範圍；Team B及Client直接URL／API均拒絕，畫面不得暫顯快取。
2. 開公司上下文及安全文件→真 upload／quarantine／scan 回讀→只有當前版本與hash一致才可覆核；未知／infected／替換舊版本拒絕。取消與返回保留篩選，reload仍見相同saved state。
3. 真業務API記錄／覆核600後餘額1,200，第二筆1,200後0；不是實際付款轉帳。重複、舊sourceVersion與相反並發決策只產生正確一次入帳與歸因audit；回到case／Today／獨立DB回讀一致。未全付、缺文件／批准的readiness維持blocked。
4. 註冊／變更詳情、checklist保存→返回清單→reload；角色拒絕、not-found、暫時錯誤分開。不能只驗URL或toast。
5. Admin 預覽離職責任→對每種owner／reviewer按已驗收的合法轉交command確認→未交完時停用／移隊／轉Client均拒絕→交完後才停用→舊身份即時拒絕、同事讀到責任與審計。**目前完整跨業務轉交command／creation-vs-disable競爭仍是本機未結項，不能跳過後稱這步可執行。**
6. 每步保留API request/response facts、實際SQL／object readback與browser reload，同時驗空態、錯誤、重試、並發、取消、返回。以真角色作為actor，不用注入session替代。

## 用量、清理及精確待批操作

以下是未授權的建議執行上限，需對具體target批准後才生效：單一隔離站／同一候選；最多2個同時browser context；最多200次業務API讀取、50次合成業務command、4個≤5MiB合成檔案；遇unexpected actor/target/write或預算到頂即停。外部訊息、付款轉帳、實際交件、付費AI／其他服務呼叫上限為0；provider真整合缺口獨立blocked，另案列recipient／destination／cost上限才可批。

待批操作必須分開：

| 待批項目 | 對象及影響 | 執行／回復邊界 |
| --- | --- | --- |
| 原生站同版接入／登入／唯讀核對 | 指定已存在隔離URL、artifact、Auth tenant、DB branch及QA角色；會建立測試session | 非秘密IDs核實後才能開始；只有read scope不代表write授權；sign out自己的QA session |
| QA業務寫入及文件回讀 | 上述精確合成IDs／keys，最多50commands／4files；含內部ledger／staff資料變更，不是正式帳戶 | 全部前後snapshots與audit保存；失敗不盲重送；不得改scan狀態造成功，必須走真sandbox scanner |
| 如沒有同版站而需建立／部署／套schema | 指定非正式project/branch、source SHA、預估費用與rollback artifact；目前沒有對象 | **未批、不得執行**。先完成可review部署／migration候選及backup；此輪no push/merge/deploy仍有效 |
| cleanup | 本輪可證明owned的QA IDs、object keys或完全owned disposable branch | 再核身份／inventory；不可blanket delete、停用retention或刪正式帳戶。需保留不可刪audit時，經另行批准整體dispose精確隔離資源；保留manifest與零殘留/資源不存在證據 |

本機既有512MiB／1CPU／1GiB tmpfs及RAM gates只適用本機SQL，沒有擴展成原生資源授權。Production migration／實際帳戶與權限／訊息／付款／交件、push／merge／deploy一律不在本輪內。這份文件不代表任何provider能力或員工可用狀態已通過。
