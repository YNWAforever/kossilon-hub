# Branch cleanup

The repository accumulated ~200 `codex/*`, `claude/*` and `cursor/*` branches. They are not
release artifacts: every merged branch's work is in `main` and its PR is retained. This runbook makes cleanup
auditable and fail-closed.

## Read-only audit (safe, default)

```bash
npm run hygiene:branches            # prints JSON
npm run hygiene:branches -- --write # also refreshes docs/releases/branch-hygiene-latest.json
```

The script lists every branch and classifies it:

| Class                | Rule                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **safeToDelete**     | not `main`/`demo`, not protected, **no open PR**, and GitHub compare says `ahead_by === 0` (fully merged into `main`) |
| **openPullRequests** | a branch is the head of an open PR — never delete                                                                     |
| **unmerged**         | ahead of `main`, or compare data unavailable (fail closed) — never delete                                             |
| **retained**         | `main`/`demo`, protected branches, or explicitly retained names                                                       |

Latest receipt: [`../releases/branch-hygiene-latest.json`](../releases/branch-hygiene-latest.json).

## Deleting branches

Deletion is a separate, approved operation:

```bash
npm run hygiene:branches -- --delete-safe --yes
```

- Requires **owner approval**; run it only after reviewing the receipt's `safeToDelete` list.
- Never delete `main`, `demo`, protected branches, branches with open PRs, or unmerged branches. The script enforces
  those rules; the flags cannot widen the list.
- Prefer small batches (e.g. one session/day) so an accidental classification is easy to reason about. Git history and
  merged PRs keep the work recoverable.
- Do not force-push or rewrite pushed history (Lovable constraint).

## Executed cleanup — 2026-11-09 and 2026-11-10

- **2026-11-09:** audit found **169** branches; deleted this session's own merged `*-20261109` branches after verifying
  they were in `safeToDelete` — **19 branches**, each with a merged PR. Post-cleanup: **150** branches
  (**94 safe**, 2 open PRs, 53 unmerged, `main`).
- **2026-11-10:** owner approved deleting the remaining safe batch. `hygiene:branches --delete-safe --yes` deleted
  **94** branches. Post-cleanup audit: **55** branches — **0 safe**, **1 with an open PR**
  (`fix/node22-queue-test-speed`), **53 unmerged**, `main` retained. No open-PR, unmerged, `main`, demo or protected
  branch was touched.

Receipt: [`../releases/branch-hygiene-latest.json`](../releases/branch-hygiene-latest.json).

## Retain on purpose

Release/evidence branches referenced by a receipt or a deployment record, branches attached to an open PR, and any
branch explicitly named by the owner. When in doubt, keep it: an unmerged branch may be the only copy of a change.
