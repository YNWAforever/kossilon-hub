# R13 / F25 — existing dependency audit gate

Base: current main `da82677bdeb35b9255425be61bd66abd295f5cc1`. PR142 adds Operations F23/F24 only and must remain a separate change. Its run37678792755 fails in both runtime legs at Bun's existing low-level dependency audit, before product gates.

Deliver the smallest compatibility-tested dependency patch with npm/Bun lock parity. Resolve shell-quote GHSA-pqg4-j6r4-53mv and source-map-js GHSA-68fv-2mgg-jv7q at their published patched floors. sprintf-js GHSA-hp3w-g68c-fv3c has no patched version; remove its dependency path through mammoth's obsolete argparse, preserving actual DOCX API and CLI behavior. Do not label an upgrade to sprintf-js1.1.3 safe.

Watch meaningful pure upstream regressions and current audits fail before modifying dependencies. Test shell quote rejection without executing a shell; validate source-map offsets without allocating a giant mapping; test real synthetic DOCX conversion and mammoth CLI arguments after the argparse change. Preserve the formatter pin, existing overrides, 24h supply-chain guard and every CI gate. No audit threshold change, exclusions, fake package version or vendored provider stub.

Run fresh npm and Bun installations/audits, npm-installed lint/typecheck, whole product tests including actual disposable PG18, build/import/browser/native-handler gates through unchanged CI. Record exact skips and local/CI/runtime/release separately. A dependency source PR is not authority for migration, production promotion, provider messages, roles, bindings or real cron triggers.

Preserve original50 UAT, prior evidence, all application authorization/domain code and the consumed P1v6 packet/claims. R01 production maintenance candidate is based on aa5d3cb and remains a separate release contract; do not bring main's schema/domain changes into that candidate. Exact current web/scheduler artifact evidence is distinct from main CI.

Rollback: ordinary forward revert of this isolated patch before release; do not choose a known-vulnerable deployment as a routine production rollback. No DB changes are part of this task.
