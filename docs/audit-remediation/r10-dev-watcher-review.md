# R10 watcher：唯一 fresh review 及修正

唯一 reviewer：GPT-6 Astra/high，fresh context、read-only；沒有第二個 reviewer。
範圍 `348da8a..43e50ad`。Critical 0／Important 1／Minor 0。

Important：normalized root 直接加入 glob 時，合法括號、brackets、braces 等
folder 名會變成 pattern 語法，其他 worktree 仍被掃描。作者採納。
真 Windows filesystem fixture 的 root 是 `project (copy) [draft] {a,b} + @tag!`：
RED 4 PASS／1 FAIL／0 SKIP。escaping 嘗試仍 FAIL，原結果保留；改成依
root-relative path 的 `.worktrees` segment predicate 後 GREEN 5 PASS／0 FAIL／0 SKIP。
active checkout 位於 `.worktrees` 內時仍有 active change event。
最終 predicate 的同一 root API probe 第一次30秒未見 listening，保持 incomplete；
第二次在24.12秒 listening，27.71秒 sample 為77目錄／0nested。cache／順序／load
未受控，沒有啟動提速結論。兩次原檔皆保留。

修正 commit：`0c374bab6e18fba1bae4f87ddd6a44475b4be73a`。完整 suite 及最後
exact-head CI 只在實際完成後記於 append-only
[fix-pass 回條](evidence/2026-10-05-r10-dev-watcher-review-fix.json)。
初始 head CI 全綠仍不能越過已確認 Important；禁止以該 run 合併新 head。

## Rulings

1. 沿用隔離 checkout，從 main 開公開 source branch，保留私有 role branch；
   維持既有歷史與未批准包的界線。若判斷錯誤，要重新核對 private package／ancestry。
2. 唯一 fresh review 在發布合併前，task closure 在交付／private sync 後；
   避免先合併未 review 結果。若 gate 未满足，交付保持 pending。
3. Windows first-request timeout 保留 follow-up；前後均失敗，本 slice 未聲稱治好。
   代價：Windows dev readiness 仍有限制。
4. 完整 browser HMR chain 未驗收；本證據只確認 watcher events。
   代價：browser HMR 仍需獨立驗證。
5. production SLO／fresh role／provider／native UAT 維持 blocked／NO_GO；
   沒有 target acceptance 或必要 owner input。代價：正式 release 不能推進。
6. 初次 tmpfs exact compiled hook 不可讀；原 exact-head CI gate 保持必須通過。
   代價：hook gate 失敗即禁止 merge；fix-pass 在 tmpfs 退出前另收 exact hook/hash。

Reviewer declined 的四項是上述 3–6，作者逐項裁定；沒有 deferred Minor。
review finding 只用一次 RED→GREEN／完整 suite fix pass，沒有 re-review。

## 完整 single fix-pass 實際結果

Linux Node22.23.2／Bun1.4.2／owned PG18.6：243 files、2323 PASS／0 FAIL／0 SKIP；
local browser12 PASS，兩個 install tree lint/typecheck、兩個 lock audits0漏洞、build、
原 dev gate12routes及 exact compiled scheduler hook 通過。built hook artifact
SHA256 `2a906461bf4871a89651de32dc0ae347cf4d9ffaa4c7711051d51f36d37aa9ac`，
只屬本機 artifact，不是正式 scheduler receipt。正式 NO_GO／genuine0；
final exact-head 原 CI 仍為合併前條件。
