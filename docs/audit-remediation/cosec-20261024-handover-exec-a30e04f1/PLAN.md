# UC186：實際並發重現、合法跨業務交接

Base交付104af5c／候選209aef6，核對HEAD、branch、remote及clean狀態後續做，保留上一輪null-skill修補與所有失敗。Run cosec-20261024-handover-exec-a30e04f1；先核實實際執行上下文RAM，再建立唯一disposable red target，保持原3GiB、512MiB／1CPU／1GiB tmpfs、無shared mount及固定已安裝image，不以初步RAM取代actual gate。

先恢復已封存SQL oracle，原incorporation admission與Admin disable產品碼不變。先實際觀察disable未提交→new case等待→disable提交後create結果與獨立資料回讀，保存RED，再處理最小root-cause修補及assignment雙向競爭。Role／current profile、team、skill、owner/reviewer分工均不可繞過。

完成合法交接：明確owner／reviewer接手人、完整權威parent＋active work scope／版本預覽、atomic確認command、穩定operation ID及未知回應重試／receipt、逐項audit與獨立readback。整批任何拒絕不得半完成；涵蓋stale、錯角色／隊、inactive／狀態不一致、locked／terminal、空態、取消、重複／並發。

沿用同一staff lifecycle key，在outer責任writer transaction最先shared admission，disable／handover exclusive；檢查annual/incorporation/corporate/work、import/bulk／maintenance入口，防止late lock inversion。這是待實作方向，不是已通過證據；先重現再改。

按影響跑必要unit/component、typecheck、lint、SQL與build；每步先資源／target identity gate。DB client／fixture／migration／cleanup前核實metadata、root、image、mounts、loopback、SCRAM及實際server/DB/systemID。SQL用注入session＋disposable superuser，不能升格為原生Auth/HTTP/RLS/browser。保留184列及F/R/UC/LA編號；原生70BLOCKED／114NOT_RUN／0PASS、NO_GO。

授權只有本機code/tests/docs及已核實可丟棄資源；無push／merge／deploy、正式migration／資料／帳戶／權限、訊息／付款／交件／付費服務。資源不夠不停止別人工作或降低門檻；外部缺口獨立blocked。Graph metadata逾時，沒有重試先前遭拒的私有indexing，改讀已知路徑。使用產品開發執行與Postgres transaction/locking技能指引。
