# B03：餘下 dependency 安全修復

## 範圍及實際結果

Source `944f703e0a95a6f96a7ee3a47107e605b04b0f2a`，base PR11
`8b834f48b11d4dbdbc81959ec5b01804ab7320d7`。新增具體 bug B03，原
T00–T23／F01–F20／50 UAT 不變。正式 DB、binding、部署、外發及邀請沒有操作。

2026-10-02 實際 Bun audit：13 package 告警／exit1 → 0／exit0；npm audit：
9（6 high／2 moderate／1 low）／exit1 → 0／exit0。報告是當日 registry 的
已知 advisory snapshot，並非整個 app 沒有安全問題的證明。

兩份原始 JSON、official metadata、resolved inventory 在
`evidence/2026-10-02-b03-*.json`；before 的 Bun stdout 版本前綴只在可解析
JSON 副本移除，原 log 保留於 ignored evidence 目錄。

| Dependency               | 相容修補約束／處理                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| @babel/core              | 7.29.7；保留 Babel 7                                                                                                                                 |
| @xmldom/xmldom           | 0.8.15；保留 mammoth 1.12.0 的 ^0.8.6                                                                                                                |
| baseline-browser-mapping | 2.11.0                                                                                                                                               |
| browserslist             | 4.28.7                                                                                                                                               |
| brace-expansion          | ^1 消費者用 1.1.21，^5 消費者用 5.0.12；不跨 major                                                                                                   |
| js-yaml                  | 4.3.2；保留 YAML 4                                                                                                                                   |
| nanoid                   | 3.3.18；保留 nanoid 3                                                                                                                                |
| postcss                  | 8.5.28；保留 PostCSS 8                                                                                                                               |
| postcss-selector-parser  | 6.1.3；保留 selector parser 6                                                                                                                        |
| undici                   | 7.29.1；保留 jsdom 的 undici 7                                                                                                                       |
| vitest／@vitest/mocker   | 4.1.11 同版套件；唯一 direct dependency 更新                                                                                                         |
| tsx／esbuild             | tsx 4.23.15 相容範圍支援修補的 esbuild 0.28.1；重新解析時移除 Bun 未引用的舊 tsx／0.27 子樹，npm 同樣不含漏洞版本；保留 Lovable 所用 esbuild 0.25.12 |

`resolution-inventory.json` 逐一列兩份 lock 的實際版本，並核對 Bun 的
consumer declared ranges，mismatch=0。所有其他 direct resolved versions 保留，
TanStack／Better Auth／PDF.js／Lovable／Nitro 的 exact pins 保留。沒有加入
new direct dependencies、force fix、忽略 severity 或 release-age exclusions。

## 重現及相容性

- [官方 XML advisory](https://github.com/advisories/GHSA-8344-3jmq-59r6)
  指出 well-formed 大量 attributes 的二次時間去重。實際安裝的
  mammoth→xmldom 路徑，Node22.23.3／Windows，每個大小三個新 worker，
  每個 worker 15 秒 timeout，最多 32,000 attributes／340,894 bytes。
  使用 `node scripts/benchmark-xml-attributes.mjs`，沒有 production request。
- 2k／4k／8k／16k／32k 的中位數（ms）：20.97→10.12、74.09→13.54、
  91.04→24.52、440.19→42.39、2218.42→73.81。這是 synthetic parser
  characterisation，沒有把 wall-clock threshold 放入 CI，亦不冒充 staging SLO。
- [官方 YAML advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh)
  的 empty merge work budget：舊 installed js-yaml 無視限制，實際 RED1；
  修補後超出 budget 拒絕，正常 Unicode merge 保留，GREEN2。這是 build
  parser dependency 契約，沒有聲稱 app 對外暴露 YAML endpoint。
- Actual Chrome 390×844／1280×900：真正壓縮 OOXML DOCX 經 existing
  `parseFile` 保留香港文字、paragraph、literal `<script>` 文字／chunks／summary；
  同時真正 PDF parser＋worker 回歸。Before4PASS10.2s，after4PASS21.8s，
  completion4PASS8.6s。沒有 stub parser、clean scan、R2、AI 或 receipt。

## Installer／lock 決策及保留的失敗

1. Bun1.3.14 named-transitive dry-run 會新增 direct dependencies／升 major，
   version-scoped override 則無效；沒有將乾跑結果套用。
2. 只在 worktree 裝 official Bun1.4.2 portable；GitHub asset SHA256
   `ce4c17497b2f29712a99d3d53f028de28cd42e3bacb8589599e7f000e49b6405`
   已核對。`packageManager` 及 CI 固定1.4.2，v3 lock 需要支援 scoped
   overrides 的 installer；舊 Bun 不應用於此版本。官方2026-09-05版本，
   所有 patch metadata均超過24小時，`bunfig.toml` 未變。
3. npm10.9.9 原 lock 更新的 Arborist `edgesOut` null 在 clean scratch／
   prefer-dedupe 仍重現。使用 integrity-verified isolated npm12.2.0 解析，
   沒有修改 global npm 或略過 peer validation。
4. 第一份 npm12 lock 雖 audit0，真正 npm ci 發現 missing edges，因此拒絕
   交付。經 installed graph／npm10 正常 normalize，第一輪 prefix clean install雖 exit0，但 fresh reviewer發現
   undeclared file:../.. self-link，該證據已拒絕。真正獨立cwd重新解析及
   original npm10 `npm ci --ignore-scripts` exit0，721packages installed／0
   advisories，manifest一致且沒有filesystem link。RED2→GREEN4；CI亦在
   independent temporary cwd實際npm ci。所有先前失敗／optional WASM cleanup
   warning保留；無 force、legacy-peer-deps 或自動刪除。
5. Bun frozen install exit0／752 installs across830 packages。新增 CI 明確
   audit 兩份 tracked locks，low severity 亦不得省略。

決策代價：installer pin需要其他環境同步；registry新 advisory可使 CI 拒絕；
目前只有已知 dependency advisory 清除，未驗證的真 corpus/provider仍可能揭露
其他問題。Vercel/Linux安裝／完整回歸結果須各有實際證據。

## 發布及 rollback

正式 release 仍 **NO_GO**：source50 migration IDs 與 last-observed production66
historical IDs未核對，31 UAT blocked 的 owner／next action 保留於
`release-checklist.md`。B03 沒有新 migration 或 production schema 差異。

只按 PR11→B03 次序 integration，逐步重跑 CI／真 PG。若有 dependency
compatibility regression，停止 activation，使用 additive revert／已批准的
previous deployment rollback；不 rebase／force push，不還原 DB ledger。
Rollback to old dependencies會重新引入已知告警，須保留 security NO_GO。

完整 Node22／PG17 gates、sole fresh review、remote CI／preview 的實際結果由
後續 evidence／台賬記錄，不能由 targeted PASS推定。

## 最終修正 source gates

26ef92d3f7346e929271ff99a876c3ca19f48167: actual Node22.23.3／Bun1.4.2／PG17，230files2183PASS0fail0skip414.52s，ChromeDEMO12PASS30.0s；14完整CI gates及compiled native hookPASS，lint0errors1existingwarning。初次dev root timeout保留；相同gate最終12routesPASS，沒有放寬timeout。單次review唯一Important修正／GREEN4；沒有rereview。正式schema／provider／31 UAT blocker不變。
