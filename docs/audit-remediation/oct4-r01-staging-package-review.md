# R01 staging package：一次分支 review

## 範圍與結果

唯一 fresh read-only review：GPT-6.1 Sol high，`f5efd1283d00f02189e51ddf1e287d35a547360d..a13b973196fbec422afd14e1ebde7191a62a791f`。初始0Critical/1Important/1Minor；沒有第二個 reviewer或re-review。raw report/hash在 `evidence/2026-10-04-r01-staging-request.json`。

Important：新 receipt 把 unqualified node 的七項契約寫成 Node22.23.3，tracker新追加 command亦稱 explicit Node22。首次7PASS/raw不改，exact first-run runtime未捕捉。以 `C:/Program Files/nodejs/node.exe` 前後 metadata鎖定Node24.18.0，原七項不改重跑7PASS0FAIL0SKIP，修正本輪label；歷史Node22/PG18證據不改。

原Minor重評為Important：Phase B把fresh login/SBOM/core smoke寫成setup前置，會阻塞操作者建立所需runtime。唯一修正批次將prerequisite inputs與acceptance_after_operation分開，全部真驗收gate保留。文件契約實際RED同時列兩項失敗→GREEN package驗證exit0；這不是新的產品RED、providerPASS或UAT結果。初始a13 proposal/receipt在Git及精確hash archive保留；新request hash `47770d20a4aa73bfb7ba17618c1b5dfc0ff6548abf8042b4575a2c38f6ab6e1b`，Phase A tool arguments不變。無deferred minor。

## 所有判定及成本

1. 已知project/parent加提議新名稱，provider-assigned ID/origin保持null：使用者只選具體審閱包；錯判需retarget，尚無外部state。
2. 純文件/非執行request用fact/hash驗證與已有契約，無杜撰產品RED或重跑不相關local DB suite：沒有產品/SQL/dependency改動；錯判可能漏文件事實，仍須review/CI及正式操作前核實。
3. 將Phase B循環前置Minor重評Important並在唯一修正pass修正：保留inputs及真驗收；錯判成本為額外文件guard/hash更新，無產品或外部改動。
4. Reviewer暫不判hosted creation/Auth/grants/schema/SBOM/ticks：全部保持not_run/blocked；錯判會令runtime未驗證，不能獲GO。
5. Reviewer暫不重跑historical candidate full suites/CI：保留原receipt及身份/hash，deploy前refresh；錯判需候選再驗證，不能用文件CI放行runtime。
6. Reviewer暫不判final documentation-head CI：新exact-head所有原gate及normal merge後exact-main獨立CI必須真綠；錯判就是尚未完成source交付，不能沿用PR124CI。

## 未發生的操作

hosted writes0、native ticks0、genuineUAT0，原50與protected9 bytes不改，正式NO_GO。Source commit/PR/merge不執行request；Phase A copy仍需精確hash-bound授權。Phase B/完整R03所有實際target/role/Auth/R2/owner/restore/native/provider gate仍在operator package及tracker。
