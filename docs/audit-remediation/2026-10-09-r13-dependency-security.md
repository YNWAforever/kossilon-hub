# R13 / F25 — current dependency audit repair

Source change: `a12d53ec3935b82b1be09020f05eb547fa324661`, based on main `da82677bdeb35b9255425be61bd66abd295f5cc1`. Independent of Operations PR142. Commands, timestamps, exact counts and log hashes: [receipt](evidence/2026-10-09-r13-dependency-gates.json).

## Reproduction and minimal fix

| Dependency path | Before | After | Official advisory |
| --- | --- | --- | --- |
| launch-editor → shell-quote | 1.9.0, critical | pinned 1.11.0 | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) |
| PostCSS/Tailwind/css-tree → source-map-js | 1.2.1, high | pinned 1.2.2 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| mammoth → argparse1 → sprintf-js | 1.0.3, moderate | argparse2.0.1 removes the path | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) |

sprintf-js has no patched release in the current advisory. Updating it to1.1.3 is not a fix. Existing mammoth API and CLI continue converting actual synthetic DOCX bytes. Shell tests call only the quoting function, never a shell; source-map tests reject invalid offsets without allocating an enormous map.

Fresh baseline npm audit: exit1,5 affected package nodes representing3 advisories; selected Bun audit: exit1,3 advisories. Initial security regressions:7fail/2positive DOCX pass. Scoped argparse@^1 worked in Bun but clean npm11.16/12.2 retained1.x; the final global pin resolves2.0.1 in both. The installed-parser dependency assertion separately failed against baseline argparse1.0.10, then passed in both clean trees. Parent worktree module visibility is not an installed dependency path.

npm lock regeneration also normalized67 unchanged-version metadata records, hoisted the existing argparse2 path, and pruned Nitro's optional peer lru-cache11.5.3 entry. Other lru-cache versions5.1.1/11.5.2 remain unchanged; no other package version was upgraded. These changes are installer output, retained for portability and covered by the actual npm build/full suite. Bun's focused diff preserves every other resolved version. Original Prettier3.8.3, existing overrides, supply-chain24h guard and complete CI configuration retain their bytes. All three selected versions were published more than24h before installation.

## Actual local gates

| Gate | Result |
| --- | --- |
| Fresh npm12.2 ci (scripts disabled) | exit0;651 installed/652 audited;0 vulnerabilities |
| Separate fresh Bun1.4.2 frozen install (scripts disabled) | exit0;649 installed |
| npm/Bun existing low audits | both exit0;0 vulnerabilities |
| Installed security/DOCX tests | npm9/9; Bun9/9;0skip |
| Actual disposable PG18.6 full product suite | 244files/2332pass/0fail/0skip; Node22.23.3; default forks, maxWorkers4 |
| Fixture migration/reference data | 50 source migration bodies applied and transaction committed; synthetic reference seed only |
| npm-installed lint/typecheck/build | exit0; lint0errors/1existing work-queue warning |
| Built Worker scheduled hook | present; no native scheduler tick executed |
| Predeploy dry-run | exit0;38read operations/0network/0writes; real provider gates BLOCKED |
| Original release ledger | local contract PASS; release NO_GO; original50 unchanged19historical LOCAL_ONLY/31blocked/0new genuine PASS |
| Exact-head remote CI | pending draft PR; neither historical green main nor this table substitutes for it |

Retained non-passing setup attempts: global Bun1.3.14 rejected lock version; selected Bun sandbox DNS failed; npm test startup hit sandbox EPERM; the first new lint run found an unsafe finally throw; corrected lint0. The first installed-path assertion saw a parent's old sprintf-js and failed; corrected installed-parser assertion RED→GREEN is recorded. No gate/timeout/expectation was weakened.

The PG18 test child exited0. Its wrapper exited1 after exact-owned removal because it compared uppercase `No such` with Docker's lowercase `no such object`. Read-only label inventory and exact-name inspect confirm no owned container remains. That wrapper failure stays recorded separately. Removal requested anonymous-volume cleanup; volume absence was not independently enumerated. No local fixture rerun or hosted operation followed.

## Release and rollback boundary

Production web is still aa5d3cb/READY deployment dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT at the current read. Production resolved bundle dependencies and the separate scheduler artifact were not inspected. PR124 merged into the maintenance branch as d8c9312, which still has these F25 source paths; R01 needs an independently tested dependency follow-up. Do not promote the main schema/domain bundle as a security hotfix.

This patch adds no migration and changes no authorization/domain/provider code. Ordinary divergent-history refusal remains. Roll back a source candidate before release with an ordinary forward revert of this isolated dependency commit; formal rollback must select a compatible safe artifact, not a known-vulnerable default. Production migration/deployment/role/provider/cron changes require the reviewed release contract and applicable authority.

| Remaining input | Owner | Next concrete step |
| --- | --- | --- |
| Supported metadata route and backend TLS policy; restricted staging app role | Human DB/Release/Security owner + Neon | Resolve the P1v6 backendSSL=false gate through confirmed policy/route. Its once/window is consumed/expired; do not reuse claims or send SQL. Prepare a new packet only after the route is established. |
| Fresh Auth staging origin and controlled accounts | Auth owner | Approved origin, five controlled identities and fresh authentication receipt; no grants/invites inferred. |
| R2 byte roundtrip, scanner protocol and scoped fixtures; OCR/AI model/corpus | Storage/Security/Reviewer owners | Supply approved binding identities/secure channel references and native sample results; do not mark legacy metadata clean. |
| WOZTELL controlled recipient/protocol; verified handoff destination/return | Messaging/Filing owners | Approved native adapter proof and sample receipts; drafts/unknown outcomes/downloads retain existing safeguards. |
| Same-schema patched web/scheduler candidates, restore/freeze and native ticks | Release/DB/Operations owners | Prepare independent R01 follow-up and obtain genuine staging receipts before formal promotion. Record web and scheduler SHAs separately. |

Prior P1v6 requests, claims, SQL, raw results and worktree38123c9 were untouched. Seven unknown table owners and other historical release gates are not cleared by these local tests.
