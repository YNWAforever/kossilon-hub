# 原生驗收精確待批包：只準備

香港日期2026-10-25；起點交付`531887acce5468f7321a3a2919a7afaa20dedac1`／候選`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`。已重核正確Git root、origin、branch、HEAD、worktrees及clean起點，沒有後續交付需要承接，沒有reset或覆蓋其他工作。遠端main與production本輪未接觸，舊遠端SHA只作歷史。

## 已完成的準備

- [APPROVAL-CHECKLIST.md](APPROVAL-CHECKLIST.md)：精確環境bindings、21個既有QA角色alias（含獨立PAGING_SOURCE）、合成資料批次、完整流程、AP-00至AP-12操作／影響／依賴、Core配額與額外用量、cost及清理邊界。所有真實target/role/fixture/費用/清理IDs未填即NOT_READY；不假造URL或Auth ID。
- [approval-request.json](approval-request.json)：機器可讀審批候選，全部未批、execution_enabled=false；沒有可執行native setup／migration／cleanup腳本。
- [COVERAGE.md](COVERAGE.md)與[native-scenario-map.csv](native-scenario-map.csv)：審閱原184列及最新交付；176 PARTIAL_SCOPED、7 SOURCE_ONLY、UC134 NOT_RUN。未識別已記錄且獨立於原生環境的本機核心缺口；保留判斷範圍。100個UC各自原route／role／data／steps／expected與F/R/LA關聯對到待批包，沒有改原編號或新增不相關UC。
- [acceptance-results.csv](acceptance-results.csv)：與531887ac交付內的原184列表**逐byte相同**。其中evidence_paths仍以`../cosec-20261025-build-d29cd5ec/`為解析基底（見evidence-path-base.json），不把複製CSV誤當新runtime結果。
- [source-candidate.json](source-candidate.json)／[release-candidate.json](release-candidate.json)：候選未變，原生0PASS／NO_GO，實際外部操作與新資源0。

## 本輪核對與沒有執行的項目

本輪只跑本機文件／CSV／hash／Git blob及計劃結構完整性核對。22批／2862個prior manifested files、674個來源/config Git blobs與本機433 output檔（14,269,548bytes）重新核對；先前失敗、resource refusal、snapshots及原始evidence不改。細節見baseline.json、coverage-assessment.json、verification-report.json及evidence-manifest.json。

歷史同來源已有unit2780／288files、SQL1多階段旅程（注入session＋disposable superuser）、typecheck/lint及buildPASS；本輪**unit／component／SQL／typecheck／lint／build全部NOT_RUN**，沒有重裝或新增測試。本輪也沒有native Auth／HTTP／RLS／browser／provider／CI／排程／restore執行，不能稱原生PASS或正式可用。

## 距離員工日常可用仍欠

同版artifact／required CI／DB相容與安全接受；真身份／角色／team／session撤權及RLS；完整Today→公司／案件→文件／付款／readiness／blocker→獲授權操作→API／獨立資料回讀／返回／reload；核准calendar、scheduler freshness、backup/storage恢復、可及性／代表性效能及必要provider／filing回執。詳見[blockers.md](blockers.md)，原生70BLOCKED／114NOT_RUN／0PASS，NO_GO。

本輪沒有push／merge／deploy、建立資源、正式migration／資料／帳戶／權限、訊息／付款／交件或付費服務。文件只用普通本機新commit交付；如需回復可新commit revert本輪文件，不改已發布歷史，沒有業務或外部資源需要回復。下一步由owner審閱精確AP範圍及填妥bindings，不自行執行。
