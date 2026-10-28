# UC186 核心流程覆蓋與本輪界線

起點為交付 `7a70e3be143cf771b6693f4ec2bb491817f74ca9`／候選 `4e5b4532091d125d79ca19244a0699f26832166a`。184原列及35F／15R／100UC／34LA不改，native70 BLOCKED／114 NOT_RUN／0 PASS。原F08／LA26失敗與原有關聯保留。

| 流程／原UC | 已有證據層級 | 本輪／仍有本機缺口 | 必須同版原生驗證 |
| --- | --- | --- | --- |
| UC99–118、195 登入與權限 | 歷史mock／assumed actor SQL；本輪相關role regression | 本輪未更改Auth或權限 | 真session／HTTP／app-role/RLS、跨team／Client與撤權後cache拒絕 |
| UC119–140 Today、公司、開案 | 歷史unit/component／SQL／局部demo | 不是完整員工旅程；UC134核准calendar仍缺 | 同一身份Today→正確公司／案件→返回／reload；真資料與效能 |
| UC141–157 文件與付款 | 歷史local contract、SQL、UC149/150重試及UC155相反決策 | provider／安全bytes未獲真證據；本輪沒有重跑或提升 | upload／quarantine／真scan、proof bytes→付款→readiness→API／獨立回讀／reload |
| UC158–166 註冊／變更 | 歷史read policy／routing／checklist／invalid transfer SQL | 本輪僅發現其normal work的null-skill接手候選問題，未實際轉交 | 正確案件／owner／文件／付款的真角色閉環 |
| UC110、167–184 批次／通訊 | 歷史500 mixed XLSX parse→preview→apply→retry→readback及局部SQL | 未重跑，不以多加fixture取代native；provider仍缺 | 真upload／批准／browser續傳與撤權；真provider／destination／receipt須另授權 |
| **UC186（R26／F08／LA26）交接** | 上批真SQL修妥跨業務漏列及sequential拒絕；本輪保存missing-command UI RED、null-skill unit RED | **只修合法候選前置條件**；完整owner/reviewer command、三業務parent＋work同步、positive audit／idempotency／readback仍缺；new-case／assignment vs disable SQL未啟動 | 真Admin／來源／接手者、HTTP、reload及舊session立即拒絕；原UAT不升格 |
| UC185、187–198 維運／日常可用 | 歷史last-Admin並發、schema admission、logical restore等本機證據 | native tick、backup/storage正式恢復、representative performance仍缺；本輪未重跑 | 同版artifact／DB catalog／依賴安全／calendar／scheduler／恢復／可及性及效能 |

本輪最高優先仍是原UC186，沒有猜新UC。已交付範圍是「工作未指定技能時，合法同隊同角色同事可成為接手候選，並保持分工拒絕」。這是完整交接的必要前置，不能代表任何案件已交接或來源帳戶已安全停用。

missing-command失敗原樣保存在 `focus-red.txt` 和 `handover-ui-red.test.tsx.snapshot`。並發probe在 `handover-execution.test.ts.snapshot`，狀態NOT_RUN；四次實際provision RAM gate拒絕均發生在container建立／application client／fixture之前。沒有把靜態可能race寫成已重現，沒有加入跳過／反轉期望來宣稱UC186通過。
