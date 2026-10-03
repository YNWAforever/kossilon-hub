# B10：移除 legacy tagger 的 braces 漏洞路徑

2026-10-03香港；base implementation main `f07e822`。原T00–T23／F01–F20／50UAT保留。
此修復不改domain service、server授權、schema、provider或正式環境。正式release仍 **NO_GO**。

## 真正RED及官方路徑

文件PR120/c6fddb9的[CI37088145785](https://github.com/YNWAforever/kossilon-hub/actions/runs/37088145785)
在兩個原有Bun audit gate退出1，沒有開始tests；Bun1.4.2報1high advisory。
獨立本地npm10 audit同樣退出1，報7high aggregated consumer nodes，並非7個不同root CVE。
新[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
涵蓋braces≤3.0.3；官方registry latest仍3.0.3，沒有released patched version；
[upstream PR72](https://github.com/micromatch/braces/pull/72)仍open，沒有採用它或偽造3.0.4。

實際Bun/npm lock inventory的braces consumers為micromatch及legacy tagger的
Tailwind3/chokidar3。Bun audit顯示的概括chain不是精確installed consumer inventory；
保存before/after映射，再確認真正path是否移除。

只將既有`@lovable.dev/vite-tanstack-config` **2.7.0→2.7.2**。
官方metadata顯示2.7.2於2026-07-08發布，是本次檢查中最早不依賴lovable-tagger的
同series patch；比npm建議2.25.1更小。已驗tarball SHA512，保留既有defineConfig、
TanStack/Nitro forwarding、devtools source locations、dev bridge/HMR及framework peers。
沒有加入新framework、未合併fork、audit waiver或release-age exclusion；24h guard不變。

## 實際GREEN及相容性

- pinned Bun1.4.2正常解析及frozen install成功。兩份locks均無braces node／consumer、
  無file self-link；85個direct dependencies中，另外84個installed/Bun/npm版本均不變。
- 相同low threshold：Bun audit **exit1／1high→exit0／0**；npm audit
  **exit1／7high aggregated nodes→exit0／0**。這是當日registry snapshot，不能保證永久無漏洞。
- 真正獨立cwd、原npm10 `npm ci --ignore-scripts`成功：658added／659audited／0vulnerabilities；
  actual installed85direct版本與lock相同，無braces directory／lock node／file-link。
  optional跨platform WASM的EPERM cleanup warnings保留；沒有`--prefix`或略過peer驗證。
- 本地Node22.23.3：typecheck／lint／offline predeploy／original UAT ledger／build退出0；
  lint0errors／1existing work-queue Fast Refresh warning。真正built scheduled hook存在，
  不代表native ticks或正式部署。
- 第一輪Windows dev gate的`/`超過原15s request budget；其他11routes及import-protection檢查PASS，
  整輪exit1保留。後續same Node22 parent/child、原30s ready／15s request budgets：
  12routes及import-protection PASS。optimizer warm state可能有別，沒有宣稱cold Windows或SLO驗收。
  中間一次22parent/24child的混合runtime repeat亦保留，不當同runtime證據。
- 新source exact-head完整LinuxNode22/24 CI、真PG17及browser/build/dev/cron gates仍待執行；
  不以本地audit或warm repeat宣稱全綠。最後review／merge／mainCI／live只在發生後寫入PR。

實際commands、exit、映射、SRI及raw log hashes在
[機讀證據](evidence/2026-10-03-braces-path.json)。before installed/locks在requested manifest已改
為2.7.2但installer尚未執行時讀取，仍是2.7.0；baseline宣告以git f07e822為準。
兩份早期aggregate metadata有PowerShell Count展開／empty-root JSON parse問題，已拒絕並
用actual Node JSON parser修正；raw audits／installed映射／npm install結果未改寫。

## 交付依賴及回復

B09文件PR120及其原失敗receipt／commit仍保留draft；B10 green-only正常整合後，B09才以
正常main merge續做，不rebase/amend/squash已發布歷史。任何相容性failure均保留并阻止合併。
若修復產生regression，使用可review additive revert；不放寬audit severity或改正式DB ledger。

原50UAT byte-unchanged：19 LOCAL ONLY pass／31blocked／0not_run。
source50與last-observedproduction66歷史IDs、DB logical owners/app-role/DDL freeze/recovery、
controlled staging/fresh Auth、真R2/scanner/OCR-AI/WOZTELL/handoff/native ticks及業務性能仍缺。
owner／next action沿用[release-checklist.md](release-checklist.md)。本次无migration/env/deploy/
send/invite/grant正式操作。歷史B03的audit0是其當日snapshot，不能代替本次新advisory gate。
