# PR11／T22：單次獨立 review 與修正

Range：`918eabb586d70b1b507fa6bfe9e06f7794f344fe` → `bc4503f38e57033f79404c7be741d09fc953a9b6`。單一 fresh reviewer，read-only；Critical0／Important2／Minor0。兩項 Important 接受並於 `102b983ac0b36e7fac07a65c4223d647bb244ac4` 一次修正；沒有 rereview，也沒有聲稱 reviewer 親自跑全套 DB／browser。

## 實際 RED → GREEN

1. **發布 catalog 缺口**：原 SQL 的舊表名使 scheduler／bulk／handoff columns/indexes 消失。真 PG regression 與 missing-probe 均 RED。修正為32個實際預期 relation 的 present/missing inventory＋完整 public columns/indexes/constraints；不存在的表仍有 missing 列，沒有綠色 schema verdict。只讀 transaction 最後 ROLLBACK。初次 GREEN9/10 發現測試把 composite bulk item key 當 `id`；按實際 `job_id` 改 fixture，保留原實體欄位檢查。
2. **fresh persona 缺口**：重複 ClientA/B email 原本被接受；case/trim-normalized distinct identities 現在 fail closed，不輸出 email/password 值。Landing assertion 抽出既有行為；actual desktop Chrome 證明 Staff 與 Admin 同 `/today` 時誤通過。Mobile首次 RED 亦有 drawer遮住 heading 的 fixture問題，保存原失敗而不把該失敗稱為角色重現。修正後共享 helper核對 server-derived AccountBlock role，mobile開啟／恢復 drawer；Staff-labelled-Admin 真瀏覽器拒絕、Staff成功，390／1280兩項 GREEN14.4s。這是read-only demo回歸，不能當真Auth acceptance。

Focused：4files10PASS0skip0.967s，actual Node22.23.3／PG17；typecheck及focused lint PASS。初次完整gate（review前）：227files2177PASS0skip341.59s，Chrome8PASS22.8s，原CI各gate PASS。review修正後最終 source 結果另見 `evidence/2026-10-02-pr11-gates.json`。

## Declined-to-judge 的執行者裁決

- 原50 UAT完整核心／支援journeys：保留19 LOCAL ONLY pass／31blocked；Auth／業務／provider owner提供controlled targets、資料、核准recipient後才真正驗收。沒有把五個landing測試當整條journey。
- fresh magic-link／Google：Auth owner的真 callback／new session證據欠缺，blocked。
- 真staging build／tenant／DB isolation／account provisioning：environment bindings只是前置契約；owner-confirmed identity及已核准existing accounts仍必須提供，blocked；不自動建立帳戶／invite／grant。
- native scheduler、sole deployed trigger、backlog：Operations提供平台logs及三次真ticks；manual／compiled hook不替代，blocked。
- R2／scanner／OCR／AI／WOZTELL／handoff：對應owner／最小依賴在release-checklist/environment-matrix；沒有mock receipt或clean scan作runtime pass，blocked。
- 正式migration歷史／restore：DB／Release核對source50對last-observed66 IDs、physical DDL、原SQL/hash及非finalize restore；沒有正式SQL或endpoint切換，blocked。
- 當時full gate／Linux CI／preview：reviewer未執行；執行者以exact source actual commands/log hashes補足，沒有繼承PR10當PR11結果。
- 原audit ZIP與official advisory provenance：T00驗SHA及baseline evidence保留；B02 official reference與實際Bun/npm報告在security-triage/support evidence，不聲稱reviewer再次驗原包。
- 剩餘dependency advisories：B02修direct PDF.js；9npm／13Bun packages仍列Security／Build／document/test owner的具體path gate。沒有零漏洞／正式release聲稱。

各裁決的代價是正式發布、genuine integration及pilot acceptance仍為 NO-GO；本地程式／隔離契約的reviewable交付可繼續。
