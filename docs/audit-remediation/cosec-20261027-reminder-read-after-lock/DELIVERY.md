# Reminder receipt read after a case lock

Baseline: `b3c15cf298eb23b7288a1b683dfaadbdbbfa63b1` on draft PR #149, branch `cursor/reminder-upload-protocol-942a`.

Product commit: `6f47262a5734001377e6c15baf6e0d0817146872` — `fix(cosec): allow authorized reminder receipt reads after case lock`.

The earlier implementation note recorded that `readAnnualReturnReminderCommandForActor` used the same `record_reminder` writable-case guard as a mutation. A case that locked after the command committed could then refuse the read. This pass changes that read only.

The GET now checks active staff identity (`requireStaffUserId`) and current case visibility (`getCase`, then `assertAnnualReturnCaseVisible`) before reading the exact outbox key. It does not call `assertCanMutateCase` and does not apply the writable-case guard. A visible completed case, a case locked by `lockedAt`, and a case with `completedAt` set still return the closed receipt. A case outside the actor's scope is `Forbidden` and the outbox is not read. A missing case is `Annual return case not found.` An inactive staff actor, a client, and a staff actor with no database identity are refused before the case or the outbox is read. `Forbidden` for a hidden case is the same visibility result the notes read uses. It is not `absent`. `absent` remains the closed state that means this command did not commit.

Queue POST write guards are unchanged. `queueAnnualReturnWhatsAppReminderMessageForActor` still queues inside the existing transaction, and `queueOutboundTemplateMessage` still refuses a locked, Filed, or Completed case and still checks `record_reminder`. `recordAnnualReturnReminder` still uses `assertCanMutateCase`. The accepted command-UUID protocol is unchanged: key shape, closed states, replay skip of `recordReminder`, and the `sessionStorage` journal.

Explicit recovery finalize/resume is not in this pass. Portal journal and create response both gone, cross-tab locks, the recovery/`uploadRequestId` ban, and schema changes stay deferred. No speculative protocol rewrite.

Six new authorization tests in `src/features/annual-return/server-fns.authorization.test.ts` cover the visible completed or locked read, a hidden case, a missing case, and the three invalid staff identities. The existing client command sweep now includes this GET as well. That is not a seventh new test. Pre-fix RED, same six tests: **3 failed / 3 passed**. The three failures were the visible read, the hidden case, and the missing case, each receiving `Completed annual return cases are locked.` The three identity refusals already happened before that guard. No test-fixture typecheck failure occurred.

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS — BLOCKED / NO_GO**. This pass does not execute Native, does not bind artifact or CI evidence, and does not turn either leftover into a local PASS. Real provider delivery, Auth/RLS, a second outbox row, redaction, storage, and scan stay on the Native gate. No schema migration, hosted CI green, deploy, promote, provider send, storage write, database integration run, or production Vercel/Neon change was made. PR #149 stays draft and unmerged.

## Local verification

Commands and retained RED: [receipt.json](receipt.json).

`tsc --noEmit` exit 0. ESLint on the two changed source files exit 0. Prettier `--check` on those files exit 0. `git diff --check` on that source diff exit 0.

Focused Vitest, the authorization file plus `reminder-command.test.ts` and `whatsapp-reminders.test.ts`: **52 passed / 3 files / 0 failed**. Included in the unit total below.

Vitest `--project unit`: **2987 passed / 292 files / 0 failed**. The db project was not run. `TEST_DATABASE_URL` was not set. This note does not call those integration tests green.

No source changes after these checks. This evidence commit follows the product commit.
