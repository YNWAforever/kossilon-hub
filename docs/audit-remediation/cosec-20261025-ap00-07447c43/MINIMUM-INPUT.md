# AP-00 最小待填清單

**本輪只準備。尚未批准或執行原生操作，BLOCKED／NO_GO。** 本機欄位已由我填妥並核實；不用你再提供SHA、測試數、artifact manifest、21個角色的定義或配額草案。31個native欄位均未經實際環境核實，按階段分配，不是31條問題。

最小首輪建議是AP-01的「metadata→既有QA身份／唯讀preflight」子範圍，**不是整包AP-01、更不是Core業務操作**。只需三組資料；能提供metadata連結就不必手抄所有resource IDs：

| 待填 | 最少內容 | 缺少時 |
| --- | --- | --- |
| **1. 現有隔離站／owner** | 非正式URL、owner、專用或共享；可識別該站的project/deployment／DB project-branch／Auth tenant之非秘密ID或可信metadata連結／查詢位置 | 可直接填「沒有隔離站」或「識別待查」；保持blocked，不自行建站或套用舊production URL |
| **2. 現有QA安全存取** | 供首輪使用的**1個既有QA Admin**帳戶識別及安全登入方法／既有QA session；如要核DB，再提供可用唯讀角色／連線的安全存取位置 | 沒有QA Admin或唯讀DB存取就先只準備metadata子範圍；不建帳戶、不發magic-link／邀請，不要求你在聊天貼秘密 |
| **3. 日後核准範圍／時窗** | 是否仍只準備；若日後另批，明示metadata-only或metadata＋QA identity/DB readonly、批准者、HKT有效起迄及接受／調低的配額 | **目前仍是只準備**。提供URL／帳戶識別不等於批准執行；expiry、target與sub-scope未綁定便不啟動 |

部署SHA／checksum、CI run、SBOM／安全處置、實際DB/server/role、Auth ID→user/profile/team/revision及network allowlist，可在有**獨立明示批准**後，從已識別target逐步唯讀核實；本輪沒有查。沒有可信metadata或安全存取就先記缺口，不用你猜值。

**資料現時不用補。** Metadata／自己的QA身份與catalog preflight不讀公司／案件／付款／文件，不需要seed或500列檔案。如之後另批業務讀取／角色拒絕，才補精確可讀／不可讀公司與案件IDs、對應角色及versions；來源轉交、104責任、20個額外角色、scanner、calendar、provider、備份／裝置、清理IDs各在原AP操作包前補，不阻塞單純metadata準備，也沒有豁免它們的驗收。

可直接填以下非秘密摘要；留白不算批准：

```text
現有非正式URL／owner／專用或共享：
可信resource metadata連結或IDs／安全存取位置：
既有QA Admin識別／安全登入方法（或「暫無，只準備metadata」）：
唯讀DB存取位置（可留待DB階段；勿貼連線密碼）：
本輪仍只準備；日後另批的精確子範圍／批准者／HKT起迄：
配額：沿用或調低下列建議；目前未批准。
```

首輪建議上限：1站／1browser context、20次control-plane metadata讀取、40次業務／身份／observer唯讀、20次Auth/session requests、200次asset requests、100MiB、60分鐘。業務command／上傳／帳戶或profile/role變更／新資源／provider呼叫／新付費費用／刪除／dispose均**0**。只關閉自己的獲批QA session/client並保留資料。這是原Core上限內更小的子範圍草案；Core200reads/50commands沒有因AP-00被批准或改動。

日後也先核source/artifact／metadata target，再核QA身份和實際DB identity；未核實不建立真client或讀業務資料。登入需外發magic-link時不能繞過AP-09；既有QA session亦須精確target／Auth tenant綁定。若要寫入、fault、restore或清理資源，仍須原AP-02至12的精確額外批准。
