# 未完成及 blocked 範圍

本批 source `eafa493cf2b1e50a672e927a3b8b86346f91a199`，base `b5bcdaef300999ff30f8372456827c7651cd4080`。UC189／UC193 本機結果為 `PARTIAL_SCOPED`；原 native 矩陣 70 BLOCKED／114 NOT_RUN／0 PASS，release `NO_GO`。原編號、來源及歷史失敗維持在 acceptance-results.csv；沒有把未測列改為 pass。

| 原編號／範圍 | 現在可證明 | 尚缺及下一個 checkpoint |
| --- | --- | --- |
| UC193 還原 | 本版 50 migration、68 public tables 的合成邏輯備份／還原、catalog／應用資料回讀、角色拒絕、錯誤 archive 原子拒絕、資料偏差控制、本機時間觀察 | 獲准同版 Neon staging/provider backup、可驗證 isolation ID／角色、原生 Auth／HTTP／RLS／瀏覽器重開、object-storage 還原、保留備份 replay、正式 RTO/RPO 與 SLA；繼續 BLOCKED |
| UC189 schema 相容寫入 | identified GET party-sync INSERT 前防線；離線重試拒絕、真 SQL missing-index 拒絕及無半完成 party | 同版 native HTTP／Auth／RLS、全量 privilege／DDL concurrency／provider schema compatibility；不是所有 GET side effect 的完整審計 |
| UC188 排程 | 沿用過往 scoped 本機證據，未改 native 結果 | 真實受控平台 tick、原生身份／provider 設定與同版資料回讀，繼續 BLOCKED；不以手動本機 run 冒充排程 |
| UC134 假期來源 | 沿用既有 covered scope | 核准日曆／版本來源及其允許驗收範圍；沒有以合成假期當正式依據 |
| 其餘原 F/R/UC/LA | 沿用前批原始／scoped 結果，本批僅更新 UC189／UC193 | 原 184 列 remaining_scope 不變；原生站、正式整合、訊息、付款、交件等缺口保持其原狀態 |

沒有新 push、merge、deploy、main 自動部署或正式 migration 候選動作。現有已測本機候選、完整影響、普通 revert 方案與證據已可 review；不需要為已完成本機工作索取重複授權。後續如涉及上述外部環境，只暫停其依賴部分；先取得精確可核實 target／角色及該動作授權，不能只憑 localhost 或 test 名稱連線。

兩個本批 owned tmpfs container 及其 credential/state files 已核實清理，沒有剩餘本批 runtime process。首次失敗 archive/test/harness 記錄與後續成功一起保留；archive 本體已隨 tmpfs 處置，不能聲稱有持久備份留存。
