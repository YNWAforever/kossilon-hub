# Staff controlled-upload preparation recovery

The recovery form permanently locked after local file validation/read/hash preparation failed even though no request had been sent. Two same-turn approvals also admitted duplicate upload pipelines before React disabled the button.

A synchronous guard now admits one submission. Only errors before the upload-intent call release the guard and restore the editable file/reason form with a safe preparation-error message. Once intent creation starts, every error remains uncertain and blocked; intent/finalize writes are never automatically retried. Existing intent IDs and generic uncertainty warnings remain intact.

Scope: the mounted controlled staff recovery panel only. This does not add a receipt-read endpoint, durable attempt identity, recovery across reloads, server idempotency or actor/document lifetime hardening. Intent/finalize uncertainty still needs independent archive/upload-record verification; this pass does not claim to clear that gap. Client portal upload behavior is unchanged.

Three new regressions reproduce local-read lockout and same-turn duplicate submissions, and preserve unknown intent-creation blocking. Existing finalization uncertainty regression remains passing. The pre-fix run had 2 failed / 5 passed; focused final verification has 42 passed / 3 files, included in the full unit total. Server boundaries are mocked; no storage, DB, scan or real authorization proof is claimed. Focused review reported no important findings.

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS — BLOCKED / NO_GO**. Same-candidate artifact/required CI/security/DB/Auth binding, real staff journeys and HTTP/RLS/session behavior, storage/scan/restore, approved calendar/UC134, scheduler, device/performance and provider/filing gates remain outstanding. Original acceptance rows and approvals are unchanged. Historical builds do not bind the new source. No build, DB integration, hosted CI acceptance, deploy/promote, production Vercel/Neon change or Native execution occurred. PR #147 remains draft and unmerged.

Product: `504e0179d28dc17a3b9796fbb70b7a3d48d12317` — `fix(documents): retry local upload preparation without replaying writes`.

Final local unit/component result: **2,873 passed / 290 files**; typecheck, changed-file lint/format and diff checks exit 0. Existing Vite path-resolution and route-export warnings remain. Commands, fingerprints and logs are in [receipt.json](receipt.json).
