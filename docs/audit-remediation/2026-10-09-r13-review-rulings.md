# R13 final review and rulings

One fresh whole-branch review:0Critical/1Important/0Minor requiring change. One fix pass; no second review. Final local evidence: [review-fix receipt](evidence/2026-10-09-r13-review-fix.json). Exact-head CI remains pending; no formal release acceptance.

## Rulings I made

- Ruling: use a new manual worktree from current main after native worktree tool returned Not a git repository — frozen P1v6 branch is not the source slice for R13 — cost: managed worktree attachment unavailable; explicit paths and exact BASE guard isolation.
- Ruling: use Windows-native scoped ledger/brief and command receipts instead of Bash skill helpers — helper startup unavailable in this environment — cost: bookkeeping must be maintained explicitly and reviewed.
- Ruling: local exclude only this SDD workspace, without changing tracked gitignore — private raw evidence must not enter PR — cost: another checkout will need its own scratch ignore rule.
- Ruling: select existing pinned Bun1.4.2, retain global1.3.14 failed setup receipt — repository packageManager and unchanged CI require1.4.2 — cost: raw initial Bun attempt is not valid audit evidence.
- Ruling: replace scoped argparse@^1 override with global argparse2.0.1 — clean npm11.16 and pinned npm12.2 both retained vulnerable mammoth1.x, while Bun alone applied the selector; global pin removes it in both — cost: future argparse major adoption requires explicit compatibility review. Existing2.x path is unchanged.
- Ruling: assert the installed parser's direct dependency metadata alongside whole-lock audits, rather than universal module-resolution absence — nested worktree resolution can see an unrelated parent's old sprintf-js; baseline metadata assertion RED1, final installed npm/Bun tests GREEN9 each — cost: transitive safety depends on the retained full-lock audit gates.
- Final: Ruling: reviewer set aside pending remote CI/browser/import gates — require the unchanged exact-head gates after draft PR; local proof cannot substitute — cost if ignored: unverified release/merge.
- Final: Ruling: reviewer set aside hosted/provider/original UAT — keep0newgenuine/NO_GO and precise owners — cost if ignored: false business acceptance.
- Final: Ruling: reviewer set aside deployed dependencies/scheduler identity — leave both unobserved and separate — cost if ignored: unsafe security or scheduler claim.
- Final: Ruling: reviewer set aside independent R01 compatibility — separate schema-preserving follow-up, no main deployment — cost if ignored: historical-schema incompatibility.
- Final: Ruling: reviewer set aside original fixture volume absence — preserve not-independently-enumerated limitation; new fix-pass fixture records precise mount IDs/cleanup — cost if ignored: inaccurate local cleanup evidence.
- Ruling: declare the existing LRU runtime peer explicitly instead of retaining an ignored optional lock entry — actual clean npm ci ignores that entry and real driver import still fails — cost: installer layout/metadata changes and one explicit dependency pin requiring future review; no new package version.
- Ruling: extend portable npm CI by the focused security/driver tests — original Bun-only full suite missed the npm regression — cost: one added short test command per runtime leg; every existing gate/matrix/threshold unchanged. Supersedes the self-imposed CI byte-identity expectation, satisfies user preservation of all gates.

## Deferred minors

Argparse2 keeps deprecated compatibility aliases used by Mammoth; functional DOCX API/CLI pass, but alias-warning cleanup is deferred. Existing work-queue lint warning and build warnings are retained. No additional blocking review finding was left unresolved. Hosted/provider/physical-schema/scheduler acceptance remains blocked by the exact external inputs in the environment matrix.
