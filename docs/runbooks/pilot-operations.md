# Pilot Operations Runbook

For the staff pilot (plan §9, Phase F). Read alongside
[the firm deployment runbook](firm-deployment.md) and
[the backup and restore runbook](backup-restore.md).

## Before the pilot begins

Nothing in this repository has ever been run against a database or a provider.
Confirm each of these, in order. A "no" is a reason to delay, not a caveat to
record.

1. **Migrations `0023`–`0033` are applied.** None of them has been applied to any
   database. Applying them to a non-local `DATABASE_URL` **requires explicit
   approval** (`CLAUDE.md`).
2. **`npm run verify:firm -- --dry-run` passes**, and the `BLOCKED` lines it
   prints are the ones you expect. It reads binding _names_ only and makes no
   network calls.
3. **The `/operations` screen shows a scheduled run.** Until it does, the
   schedule has never been observed to fire on this runtime — see below.
4. **The disabled capabilities on `/operations` have been read by the staff
   running the pilot**, and each has a person who knows the manual fallback.

## The one thing to check every morning

`/operations` → 五分鐘排程.

| What it says     | What it means                                                | What to do                                                                                                                          |
| ---------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 從未觀察到執行   | No run has **ever** been recorded. Not "quiet" — unobserved. | The cron is not firing, or the deployment is new. Check the trigger is registered before trusting any reminder, escalation or scan. |
| 排程已停止       | Two consecutive ticks were missed.                           | Nothing has been evaluated or dispatched since 最後一次執行. Treat every chase list and deadline as unrefreshed.                    |
| 最近一次執行失敗 | The tick did not complete.                                   | Read the Worker logs; the row records the error's class only.                                                                       |
| 部分環節失敗     | Some passes threw; the rest ran.                             | The named pass did no work this tick. The others did.                                                                               |
| 正常             | A clean run inside the tolerance.                            | Nothing.                                                                                                                            |

A run listed as 人手 does **not** count towards the health of the schedule. Only
the cron hook may write a `scheduled` row, so running the entrypoint by hand
cannot make a dead cron look alive.

### Why the blank matters

Every other screen reads tables a person writes to. A schedule that stops firing
leaves all of them looking completely normal — the chase list still lists, the
board still boards — because the only thing that changed is that nothing is being
_re-evaluated_. This is the only screen where an absence is the finding.

## Pausing a capability

There is no feature-flag table, and deliberately so: a capability is disabled by
removing the binding it needs. That is a real pause, it survives a restart, and
it cannot be half-applied.

| To pause                   | Remove                                             | What happens                                                                                                                                        |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live document scanning     | `DOCUMENT_SCANNER_URL`, `DOCUMENT_SCANNER_API_KEY` | The scan pass reports `not-configured` on every tick. Documents stay quarantined and stay visible. Nothing is deleted; no document is marked clean. |
| The model tier of analysis | the AI provider binding                            | Tier 3 is skipped. Tiers 1 and 2 still run. No finding disappears.                                                                                  |
| WhatsApp sending           | `WOZTELL_ACCESS_TOKEN`                             | The dispatch pass fails, loudly, and the outbox retains its rows. Messages queue; none is lost and none is sent twice.                              |
| Email sending              | `RESEND_API_KEY`                                   | Same shape as above.                                                                                                                                |

**Do not pause a capability by deleting rows, dropping a table, or reversing a
migration.** Every one of those destroys evidence, and the evidence is what a
filing is defended with. `db/migrations/` is forward-only.

### After a pause

The paused pass reports `not-configured`, which the health rule treats as a
disabled capability rather than a fault — so `/operations` stays 正常. That is
intended: an alarm that is red permanently is an alarm nobody reads. The pause is
visible in 已停用的功能 instead, which is where a person should be looking for
it.

## Rollback

Roll back the **deployment**, not the data. A previous Worker version reads the
same schema; the migrations in this range are additive, and no screen depends on
a column that a rollback would remove.

If a restore is genuinely required, use
[the backup and restore runbook](backup-restore.md) — and note its open gap: a
restore must be verified for the database **and** the object store _together_,
because a document row whose bytes are missing from R2, and an R2 object whose
row is gone, both read as "fine" from one side alone. That verification has never
been performed.

## What this runbook cannot tell you yet

- Whether the schedule fires on the deployed runtime — this is
  `BLOCKED_INTEGRATION: deployment-runtime`, and the first 排程 row on
  `/operations` is the answer.
- Whether search and the board hold up past 200 cases. No dataset that size
  exists, and no query plan has been read. Adding indexes before measuring is
  explicitly out of scope (plan F2).
- Any measured benefit. No baseline has been collected. Do not report saved
  hours, accuracy or adoption without it (plan F3).
