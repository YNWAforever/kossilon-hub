# Integration configuration metadata read recovery

Baseline: 0494e3a17648fec6c620009368dbd90ac2570ca6, draft PR #147, codex/cosec-20261023.

Server semantics reviewed before implementation: getWhatsAppIntegrationStatus is a GET whose handler requires staff, reads process.env/currentProviderMode, and adds role-derived canManageMapping. getWhatsAppIntegrationStatusForEnv computes binding-presence flags, missing variable names, provider/delivery mode and always verificationStatus:not_verified. It does not probe WOZTELL, dispatch, create queue records, access storage or change credentials/configuration. Successful metadata read is not provider health, external connectivity, delivery or Native acceptance.

The automation page now offers an explicit metadata-only retry with automatic query retries disabled and cancelRefetch:false for same-turn deduplication. Loading feedback replaces the retry while fetching. The control is available where staff can reach it, including inside an already-open approval dialog. Errors are generic rather than raw server details. Cached simulated-mode/no-external-send notices are hidden during failed or pending metadata reads; they return only with successful idle simulated metadata. A live metadata result gains no health/PASS badge.

Retry does not invalidate or reload drafts, replay send, clear send uncertainty, dismiss the preview or change queue eligibility. Existing draft-read, version-preview, uncertain-send and bulk admission rules remain intact. No server/schema/config changes, protocol identities or receipt semantics were added.

Five new regressions cover initial metadata failure, pending same-turn read deduplication, successful simulated recovery, cached denial followed by live-but-unverified configuration, in-dialog retry with retained preview, repeated failure with sanitized feedback, independent read/send call counts and the existing uncertain-send gate staying closed after configuration success. Initial RED was 5 failed / 18 passed. Focused read-only review found no important issues. Tests use JSDOM/mock RPC and pure environment-status helpers, not real staff Auth or live provider operations.

Remaining tracked priorities: manual reminder queue/log reconciliation and upload lost-intent/reload recovery have no safe existing stable read handle and require explicit protocol/identity design. Cross-tab duplicate-open has no reproduced defect in this track. Actual connection/provider delivery, Auth/RLS, calendar/UC134, scheduler ticks, storage/scan/restore, artifact/CI bindings and complete staff journeys remain Native-bound. None is converted to local PASS by this read retry.

Further local Codex passes: no next high-value bounded product fix is established by this assessment, so another speculative product pass is not justified. New local implementation should start from a concrete reproduction or a separately scoped protocol review, rather than automatically adding another UI guard. This is a bounded conclusion about the tracked candidates, not proof that the entire repository has no local bugs or a completed inventory/acceptance run.

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS — BLOCKED / NO_GO**. Original acceptance rows/approvals and immutable evidence are unchanged; historical builds do not bind this source. No build, DB integration, hosted CI green, Native execution, deploy/promote, real message/filing, provider probe or production Vercel/Neon changes occurred. PR remains draft and unmerged.

Product commit: `9f5528fabe2da24fb13a0e2b88cdbea470f4aa07` — `fix(automation): recover integration metadata reads without health claims`.

Final local verification: **2,956 passed / 290 unit/component files**; focused **48 passed / 3 files**, included in that total. Typecheck, changed-file ESLint/Prettier and final delta diff checks exit 0. Existing Vite path-resolution and route-export warnings remain. Commands, changed/reviewed fingerprints and preserved RED: [receipt.json](receipt.json). No source changes after final checks.
