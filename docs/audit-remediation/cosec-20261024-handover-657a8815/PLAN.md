# UC186 未交責任遺漏：有限本機修復

起點 d2f96c899e30661943b2a59740c2e266a976d9d2；候選9c3afceae55014a024b547d47daf9d7d97e9cc44 已核實為其父版。同 root `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`／origin `https://github.com/YNWAforever/kossilon-hub.git`／branch `codex/cosec-20261023`，clean，其他 worktree 保留。Run `cosec-20261024-handover-657a8815`。

使用者目標：Admin 在員工離職前知道全部尚未交出的案件／覆核責任，開對案件；未處理前不得停用、移隊或轉 Client。原 UC186：預覽轉交→確認→停用→重讀，完整交接到合法同事、責任列明、有審計。本輪選其中跨業務責任遺漏的安全核心情境；不聲稱完整轉交 feature／原 UAT 完成。

起始待重現訊號（本輪已確認並修補）：admin repository 的 listStaff／preview／updateStaff 只計 annual_return_cases 及 work_items；incorporation createCase 正常路徑不建立 work item。故未完成註冊可能被顯示為0責任並准許停用。Corporate change case 若其工作投影不存在／已完成，也不能忽略其仍然 open 的 owner。

驗收：先以實際 incorporation createCase 的 disposable SQL 重現預覽／roster漏列及錯誤准許停用，保留完整 rows／audit。最小修補在三個讀寫入口共用一致 open-case scope，涵蓋年報 owner/reviewer、註冊 owner、公司變更 owner，排除真正 terminal。預覽列明業務類型與正確詳情路由；當有未交責任時三種危險變更及重試均拒絕且 full rows/xmin/audit 不變。保留既有 last-Admin／revision／identity guard。角色拒絕、空態／terminal對照、100筆bounded preview、獨立回讀及相關 UI regression。完整合法轉交 command／跨業務 creation-vs-disable concurrency 若未覆蓋必須列為本機未完成，不能推給 native或造成功tick。

授權仍是本機 code/tests/docs、精確核實 disposable synthetic target。固定已安裝 image、512MiB／1CPU／1GiB tmpfs、無共享 mount、loopback mapping、metadata＋SCRAM／實際 system identity 前置 gate，唯一 run／slot與精確 record IDs；3GiB DB/build、1.5GiB focused、2GiB type/lint gate沿用。禁止正式資源／帳戶／權限／migration／訊息／付款／交件／費用。No push/merge/deploy。先核對用量與路徑，不讀秘密 env。

保留18批舊證據、2534個 manifested files；184列35F/15R/100UC/34LA只附加UC186 scoped結果，原native70BLOCKED/114NOT_RUN/0PASS與歷史失敗不變。驗證受影響unit/component、typecheck/lint/build及新隔離SQL；原2768/full25/SQL1均為歷史，不能沿用成本輪pass。Graph metadata逾時8秒，先前遭拒私有indexing未重試，已使用既有路徑與允許fallback。
