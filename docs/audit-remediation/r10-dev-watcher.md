# R10：development watcher 排除其他 worktree

`BUG-R10-DEV-WATCH-01` 是本機 development tooling 缺陷。原 R10 的
F02/F07/F17/F18、UC07/18/20/24 仍保留各自驗收；本修復不結案業務 finding。
本文件保留初始 glob 修復及其量度。唯一 review 後的最新修正採 literal
root-relative predicate，見[review／裁定](r10-dev-watcher-review.md)及其獨立回條。

## 重現及最小修復

同一 Windows checkout 的 Vite watcher 在約 30 秒時記錄 741 個目錄，其中
662 個位於其他 `.worktrees` 內。Vitest 已排除它們，development watcher 沒有。
真 filesystem regression 先 RED（2 PASS／1 FAIL／0 SKIP），再 GREEN。

首次全域 glob 也會排除位於 `.worktrees` 內的 active checkout。新增該 fixture
先 RED（3 PASS／1 FAIL／0 SKIP），改為 resolved Vite root 下的 glob 後
GREEN（4 PASS／0 FAIL／0 SKIP，包括原 dev import marker tests）。兩種 root
位置均實際寫入 active/foreign source：active 收到 change event，foreign 沒有。

只在 `serve` 的 `configResolved` 加入 root scoped ignore，保留既有 watch
options、string/array/function ignores 及 `watch=null`。Windows 路徑先 normalize。
TanStack/Lovable plugins、原 test projects、CI、locks、依賴及所有 deadlines 保留。
[Vite watcher 設定](https://vite.dev/config/server-options#server-watch)仍是原架構。

## 實際量度與限制

初始 `dbcb821` 修復後同一 root 的 watcher 量度為 77 個目錄、0 個 nested worktree 目錄。
這證明 scope 改正；未證明所有啟動問題的單一原因，沒有 production SLO 結論。

原 Windows Node22.23.3／existing dependency tree 的 probe 保留：

| Probe                                    | 實際結果                                                   |
| ---------------------------------------- | ---------------------------------------------------------- |
| 原 checkout，npm launcher                | 30 秒內未見 ready；owner 終止 exact PID tree               |
| 原 checkout，直接 Vite CLI               | 20.048 秒見 ready；owner teardown                          |
| main tracked archive，直接 Vite CLI      | 5.617 秒見 ready；owner teardown                           |
| main tracked archive，原 dev import gate | exit1；`/` 首次 request 15 秒 timeout；其他 11 routes PASS |
| 修復後原 checkout，原 dev import gate    | exit1；`/` 首次 request timeout；其他 11 routes PASS       |

兩次 gate 均 PASS no import-protection violation。失敗不是 PASS。clean-source
只指 tracked source archive；`node_modules` 用原 tree junction，沒有 clean install。
launcher、probe 順序及 cache/cold state 不受控，啟動 elapsed 不能當 before/after 提速。
API watcher probe 沒有 CLI ready marker；最初 raw `ready=false` 是 classifier
不適用，actual listening/counts 有記錄，原檔不覆寫。forced teardown 的 exit1
也不當作自然 test FAIL。原 gate 的 startup30s/request15s 沒有放寬。

## 驗證及交付

本地 Linux Node22.23.2／Bun1.4.2／PG18.6：243 files、2322 PASS／0 FAIL／0 SKIP；
12 local browser tests、build 及原 dev import gate 通過。獨立 npm/Bun trees 的
lint/typecheck 及兩個 lock audits 通過。tmpfs build artifact 在 runner 退出後不可讀；
本地只驗 scheduler marker，原 CI exact hook gate 仍為合併必要條件。

exact-head CI 結果，按實際完成後記入
[本次回條](evidence/2026-10-05-r10-dev-watcher.json)。每個結果分開列命令、
source SHA、環境、count、raw hash 及限制；CI 不代替 genuine runtime UAT。

原 50 UAT bytes 不變：19 歷史 LOCAL_ONLY、31 blocked、0 新 genuine PASS。
沒有 hosted SQL、role/grant、compute、migration、environment write、deployment、
scheduler tick、外發或 invite。ordinary migrator 及歷史 ledger 政策保留。
rollback 是正常 revert 本 PR，不需要 DB 或 provider rollback。

尚欠 DB/Release owner 的 restricted app role、private service/TLS policy 引用、
DDL/GRANT freeze 及 exact approved scope；Operations/Business 的隔離 workload/SLO
及 scheduler exact artifact／owner／native ticks 仍未驗。正式 release **NO_GO**。
