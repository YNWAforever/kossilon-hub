# 模板版本及日常導覽 — T20

## 生效及復原

0082 只為目前觀察到的模板建立 revision=1，沒有補寫過往版本。既有案件三個 creation-template 欄位保持 NULL／unknown。新案件在模板共享鎖下複製完整版本及快照，之後快照不可改寫。模板更新 RPC 要求 expectedRevision；衝突拒絕而不覆蓋另一使用者。

設定頁有儲存中／已儲存／失敗狀態。失敗保留輸入；「重試儲存」由人手觸發同一版本操作。「重新載入（放棄未儲存輸入）」明確放棄本地輸入並讀取最新版本。沒有自動把新模板套用至舊案件；Admin 可讀取分頁差異預覽，歷史來源未知的案件另列數目。

正式套用前：核對 migration lineage、建可還原恢復點、交易內執行0082及保留資料檢查，再發布已驗證 app。此候選未獲正式 migration／部署授權。若 app 要回退，保留 additive 欄位、index、trigger及新案件快照，部署相容的上個 app；不 DROP 有資料的快照欄位。未 commit 的 DDL 失敗由交易 rollback。

## 實際本地證據 — 2026-10-02

Node22.23.3、獨立 Postgres17 localhost55441/kossilon_pr02_ci：T20相關10files78pass0skip（10.27s）。版本衝突復原測試1fail→GREEN。0082 populated scratch-schema transaction：舊案件NULL、兩筆資料保留、新快照 immutable、正版本 constraint、普通 status 更新及 rollback PASS。這不是正式 backup/restore 證據。

已安裝 Chrome、本地 read-only demo：390×844／1280×900兩角色共4tests PASS（16.6s）。Admin保留16links、手機 drawer Tab focus trap/Escape焦點回復、44px nav及模板input、Staff隱藏Admin links、設定頁無水平溢出。原390px設定固定欄寬導致 scrollWidth475／viewport390，測試1fail；改直排後同一斷言PASS。

Screenshots：`evidence/t20-mobile390-navigation.png`、`t20-mobile390-settings.png`、`t20-desktop1280-navigation.png`、`t20-desktop1280-settings.png`。命令：`PLAYWRIGHT_BROWSER_CHANNEL=chrome npm run test:e2e:local`。這是真瀏覽器demo layout，沒有 fresh NeonAuth／正式案件證據操作；UX-01 genuine acceptance 保持 blocked，由 Auth/業務 owner 提供受控 staging accounts及案件。

## 發現的額外 dependency 風險

Read-only `npm audit --json` 報10個依賴告警。B02待具體 triage：pdfjs-dist6.1.200在GHSA-hq66-cqwq-w95j範圍（>=5.6.83 <6.2.108）；另有XML/parser/runtime及dev工具告警。禁止 blind `npm audit fix`；先核對官方公告、實際呼叫路徑、相容版本及最小 regression，再作可審閱修復。安全風險未因本地CI綠燈結案。
