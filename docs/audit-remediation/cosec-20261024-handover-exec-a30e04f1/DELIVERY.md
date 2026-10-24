# UC186：合法跨業務交接與停用並發的本機驗收

從交付 `104af5c4875d2f10b595ec330fcb2e1d07e87201`／候選 `209aef6c78fe1ded6ad3a68eba4eaa9bd7304243` 續做，核對同一repo/root、origin、branch、HEAD及clean起點，沒有後續交付需要覆蓋。保留209aef6的null-skill修補，沒有reset、改已發布歷史、push／merge／deploy。精確本輪source與parent在release-candidate.json及source-candidate.json；**原生保持BLOCKED／NO_GO**。

本輪本機source候選：`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`，parent為上述104af5c。674檔Git blob與測試worktree內容逐byte一致。**功能SQL／unit／typecheck／lint已驗；build因實際RAM不足尚未啟動，必要本機關卡未齊。** 20個來源／測試檔的差異只處理UC186交接、相關責任writer admission及其驗收，沒有新migration。

## 已重現、修補與實際成果

- 原SQL RED：Admin停用未提交時，正常incorporation create已讀舊active，等待FK後竟在停用成功後新增責任。讀回user/profile=false、revision2、owned_cases1。保留db/test-red.txt及UC186-red.jsonl。
- ordinary responsibility writer現先取同一lifecycle key的shared admission，Admin停用／handover先exclusive；再取domain/profile/actor/job locks。納入annual、incorporation、corporate、work、import/bulk/document maintenance及manual reminder外層，避免late admission反轉。incorporation/corporate正常寫入驗current matched active staff。沒有改全域DB client或正式schema。
- Admin選owner／reviewer與原因，取得完整scope fingerprint及來源／接手人版本，讀齊100＋4分頁後明確確認；原子更新三業務權威parent和來源active work責任，保留無關child／terminal。重用指派技能、role/team、分工、版本及explicit override reason防線。沒有將work projection冒充parent轉交。
- 真SQL scope為101宗案件＋3筆工作，含annual owner與reviewer、incorporation owner、corporate owner、work reviewer；不是把104列宣稱104個測試。Source remaining0後按新revision停用，舊identity／actor／owner再寫入拒絕。
- 同operation ID回讀／重試不重做；改payload／actor衝突。未知取消在同一把鎖下寫immutable marker，阻止延遲原請求再提交；已commit便回原receipt。取消與轉交的接手人／原因／指紋、old/new角色與責任、actor及逐項moves可回讀。沒有假報取消已提交的業務。

另保留三個本輪feature regression RED：舊UI回應刪新pending（targeted-delayed-red-ready）、同隊跨公司錯誤parent/work預覽通過（green-r2）、交接把blocked變in_progress（green-r3）。分別以generation＋operation ownership、company ID＋case-kind關聯、handover-only preserveStatus修補。普通指派行為不變。39個拒絕oracle要求具體message／409/503 code、catalog injection已觸發、real parent UPDATE已執行，並保留全部row/xmin/audit不變斷言；沒有修改期望迎合缺陷。

## 本輪結果與證據層級

| 檢查 | 本輪實際結果 | 邊界 |
| --- | --- | --- |
| Full unit | **2780 passed／288 files**，unit-final.* | 本輪真結果；包含targeted44，不相加 |
| SQL | **1 passed／1 file、多階段完整旅程**，db/test-green-r4.* | 真disposable SQL＋注入session mapping／superuser，不是native Auth/HTTP/RLS |
| UI/component | Targeted44 passed／9files；包括remount／同ID重試／取消intent及舊callback防線 | JSDOM／mock RPC，不能稱真browser reload或原生UAT |
| Final typecheck／lint | **PASS／exit0**，typecheck-accepted.*、lint-accepted.* | 同674檔來源；lint保留既有work-queue Fast Refresh warning |
| Final build | **NOT_RUN_RESOURCE**；17:11:10Z actual free1,535,733,760 bytes＜3GiB，未啟動 | resource-checks.jsonl保留每次拒絕；不拿歷史build代替 |
| CI／deployed/native/provider | **NOT_RUN／BLOCKED** | 沒有push/deploy、真Auth角色、HTTP、app-role/RLS、browser、provider或正式帳戶操作 |

SQL包含六個真lock wait/PID的create／owner／reviewer兩向競爭（後5個明確advisory assert），current Admin/profile/Auth-ID及角色／inactive／foreign-team／skill／分工拒絕，stale preview／revision，same-team wrong company，locked parent，完整preview取消read-only、空態不提交，catalog讀取注入503及真parent更新後故障整批rollback，遺失已commit回應後receipt／同ID重試，取消before-late-submit及after-commit，terminal／unrelated／blocked與審計獨立讀回。Catalog故障是注入，不宣稱native schema drift測試。

逐次記錄：red是真產品失敗；首green只有migration，test被RAM gate擋在client/fixture前；green-r2重現company關聯缺口；green-r3重現blocked副作用；green-r4完整通過。Missing-command UI RED與延遲callback RED、初次4項panel selector歧義harness失敗亦保留，selector修正沒有改產品期望。歷史2076／2768及上批36／8均不是本輪結果。

## 隔離、版本、原184列及清理

Run `cosec-20261024-handover-exec-a30e04f1`，開始於2026-10-24，延續至香港時間2026-10-25。Actual gate逐步讀RAM，原門檻不改；低資源讀值與後來恢復各自記錄。固定已安裝image、desktop-linux endpoint、512MiB／1CPU／1GiB tmpfs、無shared mount、loopback動態port；每次先metadata、SCRAM、實際server/DB/user/systemID與source/migration provenance，再import/instantiate app client及寫fixture。

所有5個container及精確IDs／ports／system IDs／fixture IDs見db收據與journey；各自closure、inventory及全public projection seal核對後dispose，credential files移除。首green以empty-business fallback證明沒有app backends／fixture才清理。不停止別人process／container、不改scan/tick、不外發；fetch0只代表本機層。

Source freeze為674檔，測試head為104af5c上的本輪dirty候選；最後Git blobs／source-post-checks須與full-green-before及SQL fingerprints相等。不同RED另有snapshots，不拿舊失敗套到最後SHA。20批／2718個原manifested files核hash，原184列（35F／15R／100UC／34LA）、original_row_json、關聯、原not-tested／LA26:fail均不改，只附加UC186 scoped本輪結果。Native70BLOCKED／114NOT_RUN／0PASS。

遠端main由GitHub connector唯讀重新核對仍1c57a672；本機main是c1b41a81舊祖先，沒有fetch或移動ref。舊production未接觸。Graph metadata timeout後未重試先前遭拒的私有indexing，使用已知路徑；原AGENTS與授權邊界保留。

## 距離員工日常可用的必要關卡

1. **同版build仍欠**：actual free1.43GiB低於原3GiB門檻，未啟動；恢復資源後跑同一候選並核對來源，不能稱編譯候選已接受。其餘必要本機unit／SQL／typecheck／lint已通過。
2. 同版artifact、required CI、實際DB catalog／app-role／依賴安全；任何部署或正式migration要另批。
3. 真Auth/session及角色／跨team／Client／撤權後cache與舊session拒絕；本機fake session不能替代。
4. 真員工Today下一事→正確公司／案件→安全文件／付款／blocker→授權操作→API／獨立資料／返回／reload閉環。
5. 核准calendar、scheduler freshness、backup/storage恢復、可及性／代表性效能，以及日常必要的受控provider／filing receipt或明示人工接手。

本輪關閉case/work交接及並發的已列本機功能缺口；原UC186定義要求isolated staging，仍為PARTIAL_SCOPED，沒有將原UAT升格。待批環境、角色、資料、用量與清理列NATIVE-PLAN.md，只準備未執行。Code可用普通新commit revert本輪source；本輪合成DB已dispose，沒有真業務需撤銷。
