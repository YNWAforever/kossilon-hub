# 核心流程覆蓋表

核對起點：HEAD／最新交付 `d2f96c899e30661943b2a59740c2e266a976d9d2`，候選 `9c3afceae55014a024b547d47daf9d7d97e9cc44`；同一 worktree `codex/cosec-20261023`，clean，沒有後續交付。下列「已通過」只指原交付中記錄的局部證據，全部是歷史，沒有提升原 UC 或 native 狀態。184 列原紀錄（35 F／15 R／100 UC／34 LA）與失敗、關聯欄位保留；native 原矩陣 70 BLOCKED／114 NOT_RUN／0 PASS。

| 核心流程／原 UC | 已通過的歷史證據層 | 仍有本機缺口／本輪判斷 | 必須同版原生環境驗證 |
| --- | --- | --- | --- |
| 登入／權限 UC99–107、111–118 | Mock Auth/router/component；註冊與變更真 SQL 的 assumed actor 團隊拒絕 | 未發現應靠再加數字變體補齊的獨立缺陷；不能把 mock 登入當已開通 | Magic-link/session、登出／換帳戶、故障恢復、真角色／HTTP／RLS |
| 今日工作→開案→返回 UC119–134 | Unit/component；10,000 work SQL scope/cursor；UC130–131 指派並發；demo browser 返回／zoom | UC134 仍缺核准 calendar 來源，不能自行以合成假期替代；本機清單證據不等於真員工工作旅程 | 同角色 Today／Dashboard／work queue／case 一致，reload、錯誤、實際效能 |
| 客戶及案件上下文 UC135–140 | 真 SQL 建立／重複／BR；mocked overview；demo 長名稱／返回 | 整體公司→各案件的真身份旅程未完成；不增加任意公司樣本冒充閉環 | 真 Staff/Manager 存取、各案／文件 roundtrip、返回／reload |
| 文件／補傳 UC141–150 | 搜尋 SQL、unit/component；UC149／150 本機 upload response-loss／resume；storage/scanner 為 local contract | 供應商／安全 bytes 仍缺真實證據；本機 stub 不足結案 | 安全 storage／scan／OCR／AI、版本／hash、Client→Staff 回讀及拒絕 |
| 付款 UC108–109、151–157 | Components；UC155 真 SQL 的 partial/full、相反決策、409／重試／審計；UC157 scope/export SQL | UC151／152 matrix 描述較舊，UC155 只有相鄰支持範圍，不能直接改為完整 PASS；再將金額換成600/1200不足以構成新核心缺口 | 真 proof bytes／角色、持久入帳→case readiness→reload、跨頁／匯出一致 |
| 公司註冊／變更 UC158–166 | Read policy SQL、UC159 accessibility、UC160 routing、UC164 errors、UC166 invalid transfer 拒絕 SQL | **UC186 的跨業務交接責任可能漏列這些 open cases，選入本輪核實** | 正確案件／owner／文件／付款、完成去重、真角色端到端 |
| 批次／月表 UC110、167–173、181–184 | Scope/exclusion/cancel/retry unit＋SQL；500 mixed XLSX parse→preview→apply→readback | 核心本機去重／恢復已有實際證據；不能用新增無關 fixture 取代 native approval | 原生 upload／批准、actor 切換、並發撤權、browser resume/reload |
| WhatsApp／交件 UC174–180、183、194 | 101對話／201訊息 SQL；inbound/dispatch/receipt 的 offline contract | 真 provider account／收件人／destination 未提供；非獨立本機可結案項 | 真收發、媒體隔離、timeout/unknown核對、批准→提交→回條 |
| 員工／離職 UC185–187 | UC185 真 SQL last-Admin、兩種並發、完整 rows/xmin／audit；UC186 預覽／guard UI | **UC186（R26 P1／F08 P1）仍缺跨業務未交責任的安全拒絕驗收；本輪只修核實的遺漏，不新增假轉交成功**。完整合法轉交到同事仍須獨立驗收 | 真 Admin／離職者／接手者身份、HTTP、reload、provider account lifecycle；LA26 歷史 fail 保留 |
| Operations／恢復／整體體驗 UC188–193、195–198 | UC189 schema admission SQL、UC193 logical restore SQL；Operations mocks；demo Edge keyboard/390/200% | UC188 只能原生 tick；UC193 本機時間不是正式 RTO/RPO；UC195 native Client 隔離及UC198效能不能以 mock 補足 | 同版部署／DB／依賴身份、真 tick、備份／storage恢復、Client隔離、可及性與代表性效能 |

最高優先判斷：P0 R25 的尚缺部分涉及正式 artifact／DB／provider，維持 blocked。本輪選 R26／F08 既有 UC186 的 P1 資料責任安全缺口：若未完成公司註冊不產生 work item，而 Admin 僅計年報和工作項，便可能把仍有 open case 的員工停用。這是原流程「未處理責任列明」的直接風險；先重現，不以編號相鄰選項，也不為增加測試數重跑已覆蓋的付款數值。

本輪收尾：UC186的漏列／錯誤停用已由真SQL重現並修補；correct detail links、sole-incorporation及corporate-only拒絕、104/100邊界均有本輪證據。完整合法轉交及new-assignment concurrency仍是LOCAL_GAP。上表歷史欄不累計本輪數字，原UC／native結果不升格。

本表不是完整 UC PASS 清單。原逐列 expected／actual／historical／native／remaining scope 以本批 acceptance-results.csv 為準；本輪結果與歷史結果在 DELIVERY.md 分開記錄。
