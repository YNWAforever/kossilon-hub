# 文件分析與引用 — T16

## 已實作的本地流程

1. 沿用文件版本、R2 及 scan gate。只有當前版本、真正 provider verdict 的 SHA／大小／MIME／object key／company／case lineage 一致，worker 才讀取 bytes；再自行 hash，比對後才解析。
2. unpdf 讀取文字層，保留頁碼及 exact offsets／quote。最多 200 頁、合共 200,000 字；截斷不能當完整證據。無文字層交內部 OCR port；未配置、低信心、格式或版本不符均保持人工／unknown。
3. 規則重用已批准 requirement instances、confirmed parties 及 NAR1 年度。未確認對象／適用性保持 unknown；reference date 沒有批准 age policy 時不能自定有效期。未建立第二套缺件 authority。
4. AI 沿用既有 binary HTTP connector；嚴格 bounded JSON，頁碼必須存在於本次 evidence。文字是資料，無批准、resolve、tool 或 release 欄位。有效 citation 證明引用存在，不證明 AI 的業務意見正確。
5. 完成時同一 PostgreSQL transaction 核對 current version、SHA、context token 和 processing job attempt；再寫文字、未處理 findings、provenance 和 job completion。reclaimed attempt／案件資料改變／V1 被 V2 取代不發佈。已由人手處理的 finding 不被重新分析刪除。
6. 覆核透過現有私有 byte route 讀當前文件；逐頁引用以 plain text 顯示。resolve 必須攜帶頁面 observed UUID；交易內再驗 active users/staff_profiles、Auth ID、team/assignment。記錄人手 audit，不替代文件／package 批准。

## Provider gates

| Gate                 | Owner              | 最小下一步                                                                                                                                                                                        |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Genuine scanner + R2 | Security / Storage | 指定 staging bucket、核准的 scoped sample 和真 clean/rejected verdict；先 hash／lineage，再 extraction。                                                                                          |
| OCR                  | OCR provider owner | 批准供應商和實際 protocol、token、timeout/limits、逐頁文字及 confidence 定義；現時只有內部 port，runtime `ocr:null`。不發明 HTTP endpoint。                                                       |
| AI                   | AI provider owner  | 指定既有 binary connector 的核准 endpoint/token；真 response/quote 對照及模型版本、prompt、cost 來源。現有 protocol 沒有這些 metadata 欄位，因此 model/cost NULL、prompt unknown 標示，不能造值。 |
| Corpus acceptance    | Business reviewer  | 受控且 human-labelled A完整/B缺件/C三董事/D錯姓名年度及指令/E真模糊旋轉掃描；執行 staging，記錄 precision/recall/unknown 和人工評估。synthetic A–E 不是 provider accuracy。                       |
| Fresh identity       | Auth owner         | 受控新登入各角色及撤權／越權覆核／私有 preview 驗收；injected actor 不算 fresh Auth。                                                                                                             |

AI-01..05 的本地契約有實際測試；真整合尚未驗收，保留 blocked。不發送任何真客戶訊息，不靠 existing session、manual tick 或 stub clean 宣稱 runtime 完成。

## 0077 deployment / rollback

- `0077_document_analysis_evidence.sql` 只增加三個 nullable JSON object 欄位：version texts evidence、findings evidence、analysis jobs provenance。canonical schema/manifest 同步；歷史 NULL 保留，舊 succeeded run 缺 source binding 顯示未核對。
- 專用 localhost PostgreSQL17 已套用、repeat，及 populated rollback-owned schema 演練兩次：三表各一個舊 row 保留、三個 CHECK、array JSON 拒收 23514。此證據不是 production backup restore。
- Source manifest 45 IDs（0001–0034、0067–0077）；last observed production 66 historical IDs／aa5 build，需要沿用 T01 歷史調和與 concrete new release approval，不能直接重寫 ledger 或執行整批 SQL。
- 正式操作前：保存可恢復點／核對 exact project-branch-db/build、先部署順序演練、確認 0076 lineage gate 和 0077 physical columns、確認 owner 暫停與 genuinely controlled corpus。migration 可能短暫鎖表；未批准不操作。
- Failure：暫停 analysis maintenance，保留 job、bytes、舊 provenance、人工 decisions；rollback 交易或 fix forward。已保存 evidence 後不 drop 欄位／不 reset。不可回到會把舊版本／無引用結果當已核對的 worker；重新發佈需新 claim/current context，不盲目標成功。

Logs 位於 ignored `.worktrees/audit-baseline-20261001/`，摘要與 SHA 在 committed evidence JSON。全部 local/provider/deployment 結果分開記錄。
