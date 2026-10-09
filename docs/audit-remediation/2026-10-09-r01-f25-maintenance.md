# R01 / F25 minimal maintenance candidate

Source3e5eb75e714d7c63de81c7800c881252e2dfdca4, independently based on d8c9312 (PR124 merged into codex/oct3-live-security-base). aa5 live-source ancestry verified. No main schema/domain changes were copied. Actual commands/timestamps/log hashes and all300 protected source hashes: [receipt](evidence/2026-10-09-r01-f25-maintenance.json).

## RED → GREEN

Baseline npm5affected package nodes/3advisories; Bun3advisories. Fresh installed security/DOCX/real Nitro driver tests7FAIL/3positive PASS. Fix only shell-quote1.11.0/source-map-js1.2.2/argparse2.0.1 plus an explicit Nitro LRU peer. This baseline hasLRU11.5.2; the independently tested11.5.3 compatible patch is explicit, unlike main's already11.5.3 optional entry. Native npm/Bun locks regenerated from this branch's own originals; all selected releases >24h old. Prettier3.8.3 and supply-chain guard retained.

| Gate | Actual result |
| --- | --- |
| Separate clean npm/Bun installed contracts | 10/10 each; real DOCX API/CLI and actual LRU import/store/eviction |
| Existing npm/Bun low audits | 0vulnerabilities, both exit0 |
| Complete actual isolated PG18.6 suite | 178files/1773PASS/0FAIL/0SKIP |
| Source migration/reference fixture | 34migrations committed only locally; synthetic reference seed;300 protected source files unchanged |
| npm-installed lint/typecheck/build | exit0; lint0errors/1existing warning |
| Built scheduled hook | present;0native scheduler ticks |
| Predeploy dry-run | 36reads/0network/0writes; real DB/storage/scanner/messaging/backup/browser gates BLOCKED |
| Owned fixture cleanup | exact container and anonymous volume absence verified |
| Remote CI/review | pending this candidate; main R13 results are not reused |

Only native CRLF→LF normalisation was applied to manifest/lock/CI after initial install; parsed JSON and every non-newline byte were proven equal. No source behaviour changed during the PG test run. CI independently installs final committed bytes.

## Release and rollback

This proves source/local compatibility, not production physical contracts. Actual deployed resolved dependencies and separate scheduler SHA are unobserved. Preserve the ordinary divergent migration refusal, original main50UAT and consumed/expired P1v6 receipts. No formal DB/role/provider/deploy writes. Formal release remainsNO_GO until genuine staging/physical compatibility receipts and the reviewed release contract exist. Production branch linkage is main, not this PR base; do not promote main's schema bundle as a security hotfix.

Before release, rollback this isolated commit with an ordinary forward revert; don't rewrite published history. Formal rollback must select a compatible safe artifact, not the known-vulnerable baseline. No DB rollback SQL is required for this source-only patch.

## Exact remaining inputs

| Owner | Missing input and next action |
| --- | --- |
| Human DB/Release/Security + Neon | Confirm supported private metadata SQL route and backendTLS policy; supply restricted staging role/binding identity via secure channel. P1v6 backendSSL=false remains unmet; its attempt/window cannot be reused. Establish route before any new scoped packet. |
| DB/Release | Production physical-contract receipt against candidate34source bodies, historical restore/DDL freeze and seven unattributed-table owners; ordinary migrator remains fail-closed. |
| Auth | Approved staging origin plus five controlled identities and fresh authentication receipts, no inferred grants/invites. |
| Storage/Security/Reviewer | Scoped R2 byte-prefix/roundtrip, real scanner protocol/sample receipt, OCR/AI model and golden corpus; legacy metadata never markedclean. |
| Messaging/Filing | Official WOZTELL scoped controlled recipient/protocol/unknown-outcome reconciliation; verified handoff destination and native return proof. Draft/download !=send/submission. |
| Release/Operations | Reviewed safe web and scheduler artifacts separately identified, genuine native ticks and build/environment/hash receipt; no existing session/manualtick/mock substitution. |

Provide binding identities/secure-channel references, not plaintext secrets in chat. Source work proceeds without these credentials; genuine runtime gates remain blocked.

Review b844452:0Critical/0Important/1deferredMinor. No source change/fix pass; exact candidate CI pending. See [review and rulings](2026-10-09-r01-f25-review-rulings.md).

## Independent exact-head CI GREEN

PR144 head da4ecebd1a591dc8bf164a391504f40f18d317f4／run37894936496: Node22/24 and verify all SUCCESS. Each actual runtime:178files/1773PASS/0FAIL/0SKIP plus separate npm-installed10PASS; all old build/dev-import/cron gates retained and passed. Receipt: evidence/2026-10-09-r01-f25-ci-green.json. This docs-only successor will run its own CI; final-head receipt is maintained in PR144 metadata to avoid claiming a previous head is current. Runtimeblocked/releaseNO_GO unchanged.
