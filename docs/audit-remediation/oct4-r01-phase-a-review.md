# R01 Phase A：一次獨立整段審閱

## 範圍及結果

Reviewer：fresh-context Codex GPT-6.1 Sol/high，唯讀、禁止 provider query／SQL／改工作樹／再派 reviewer。Range：`0f509e8f0913a3931a14a1bdeba317b7dca2ad1e..da78e481d16bb0be2dacd904d89b802197aa2667`，兩個 normal commits、八個 docs/evidence/proposal files；沒有 app/migration/CI code變更。獨立跑 verifier，17raw hashes／9protected hashes／10 unrelated tracker rows／approved request/template/README全部PASS。Actual Phase A1create/5postGET/ready/non-default/0endpoint/0compute/old4branch+endpointmatch；LOCAL existing7PASS/Node24.18.0，SQL演練not_run／WSLblocked；formalNO_GO／newgenuine0。

Critical0／Important0／Minor0。Verdict：來源交付無 actionable defect；必須等原完整 exact-head CI全綠才normal merge，再驗exact-main CI。B1hash `0445f6a5a45bf4661f19306b5a0f178074da8dd3abfcfe8b330790d89b72eb98` 仍需獨立批准。没有second reviewer／correction pass／deferred minor。

Initial commit362b325的staged diff顯示SQL末尾空白行，作者於review前以normalda78e48移除並重綁proposal hashes；Git歷史保留。這是artifact hygiene，不能冒充產品RED→GREEN。

## Executor rulings

1. Provider metadata驗收對應已批准資源操作，沒有product行為變更，因此不虛構產品RED。成本／風險：既有LOCAL/CI契約本身不能證明provider實況；只按實際GET結束Phase A。
2. Auth management404只記未啟用，不能推斷clone的Auth users/roles/config/schema為空。成本／風險：過早Auth activation或外發可能曝光copied identities；相關genuine gate保持blocked。

## Reviewer declined-to-judge：逐項裁決

1. Recorded observation後的hosted/live drift：使用有時間界線的receipt，操作或最終交付前重新GET。風險：後續外部更動會令preconditions失效；不能將舊GET當永久狀態。
2. Candidate/provider status獨立refresh：作者的fresh preflight5checks及實際metadata是證據；reviewer沒做external query。風險：候選或live改動要重新評估，不能套舊CI。
3. Exact-head CI／future merge/main CI：本report不宣稱完成；保留必須全部SUCCESS的gate，實際receipt在PR發生後附上。風險：漏掉其中一步可能merge未驗source。
4. B1 PG執行／語法：只交付single SELECT提案，local WSL錯誤／SQL0executions保留；B1未授權。風險：真runtime可能拒絕SQL，須停並保留error，不能作假PASS。
5. Historical schema/ledger/data retention/effective app-role：Phase A沒有SQL；R01/R02/R03相容性／授權gate不變。風險：privileged observer或catalog snapshot不能當restricted app-role／資料保留驗收。
6. Auth rows/users/config/fresh login/expiry/revoke/scopes：management404不足，既有Neon Auth架構及五controlled identities/two-client scopes仍要真正驗。風險：未驗隔離或current server auth會暴露正式copied data。
7. Artifact/SBOM/protected origin/R2/env/provider：候選source/locks/CI不是deployed版本或真provider receipt；各owner輸入及批准保持獨立。風險：錯綁production、simulated或missing credential可能被當可用。
8. Hosted restore/seven owners/DDL freeze/external release contract：維持R03獨立blocked。風險：restore或historical divergent ledger順序錯誤可能損資料；ordinary migrator繼續拒絕。
9. Native scheduler artifact/activation/three ticks：本輪零tick；web與scheduler分開記SHA。風險：manual tick／websource／Sep30舊receipt不能證明新native runtime。
10. Genuine business UAT：原50bytes保持，19historicalLOCALONLY／31blocked／0newgenuine。風險：把metadata/CI當businessPASS會跳過正式業務驗收。
11. 八檔以外的既有產品缺陷／正式security remediation：保留已交付local evidence和isolated候選；這次只結Phase A資源scope。風險：source合併不能宣稱正式漏洞或全部finding已清。
12. Billing/quota suitability：B1明示固定0.25CU及儲存/compute成本，未執行；DB/Release owner須審閱精確scope/hash才activate。風險：未授權paid capacity或敏感clone可增加成本／存取面。

## Remaining gates

Original exact-head CI / exact-main CI；B1 compute/catalog-read/new-ID-only rollback批准；hosted historical schema/restricted role；Auth；R2/protected origin/env/deployed SBOM；restore/owners/external contract；獨立native scheduler；原50genuineUAT。沒有deferred minors。原request／not_run template／舊evidence不改。

## 審閱後的獨立本地 metadata 回條

在review range後，原SQL bytes不變，作者找到已有Docker並於空白LOCAL PG18.6執行同一SELECT，exit0/1row、inputhash相符；exact-owned network-none/no-bind container已清理。新增SQL syntax receipt及未批准B1v2，原PhaseA/B1v1不改；v2operation/catalog/rollback scopes全部與已審v1相同。裁決4的local語法部分由新實際回條支持，hosted historical/grants/Auth部分仍blocked。這是新verification metadata，沒有product／SQL／provider payload修改，不另派第二review；完整exact-headCI仍必須重新以實際final head驗證。
