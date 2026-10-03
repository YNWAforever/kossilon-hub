# B10: remove the vulnerable legacy tagger dependency path

Spec: preserve the existing TanStack/Postgres/Lovable architecture and published
history; keep both lock audits, release-age guard, every CI gate and production
authority unchanged. Registry snapshots are dated, not perpetual security proof.

Baseline: implementation main f07e822. Document-only PR120 headc6fddb9 fails
CI37088145785 on both unchanged Bun audits: braces3.0.3, GHSA-vfj7-8cjw-p6xm,
one high advisory. Independent npm10 audit exits1 with seven aggregated high
consumer nodes. Both raw failures are retained; tests were never reached in CI.
Official braces latest3.0.3 has no published patch; upstream PR72 is still open.

## Interfaces and constraints

Existing @lovable.dev/vite-tanstack-config2.7.0 depends on lovable-tagger1.2.0,
which introduces Tailwind3/chokidar3/fast-glob/micromatch/braces. Official registry
metadata identifies2.7.2 (2026-07-08) as the earliest same-series wrapper release
without lovable-tagger, retaining existing bridge/HMR/devtools dependencies and
framework peer surface. Prefer that patch over the broad npm suggestion2.25.1.
Verify actual consumer graph and both locks, not just metadata. Keep exact
TanStack/BetterAuth/PDF/Nitro pins and all other direct dependency resolutions;
no advisory waiver, invented braces version, unmerged fork or new age exception.
No new production DB/env/deploy/send/invite/grant operations.

## Task 1: verify and deliver the minimal dependency path repair

1. Save actual BunCI/npm audit RED and official advisory/registry/path evidence;
   integrity-check the minimal official wrapper tarball and inspect API/plugins.
   Expected: existing defineConfig/Nitro/server-entry and dev bridge/HMR preserved;
   age beyond24h, no braces patched-release claim.
2. Pin only the wrapper to2.7.2, use pinned Bun1.4.2 and synchronize the npm lock.
   Compare all actual direct resolutions, consumer paths and lock inventories.
   Expected: legacy tagger path absent, unrelated direct versions preserved;
   actual bun and npm audits exit0 at unchanged low threshold.
3. Run original portable npm10 isolated install, frozen Bun, typecheck/lint/build,
   dev imports/compiledcron and complete exact-head CI with actualPG17/browsers.
   Expected: all original gates green; no new mirror tests or test-budget changes.
4. Commit small source/evidence/runbook/status updates, draft PR, official
   completion gate, sole fresh whole-range review. Merge normally only exact
   reviewed green head; verify actual mainCI and live metadata after occurrence.
   Expected: B09 draft/failed receipt preserved; resume its ledger after B10.

Task completion command: owned gate revalidates final package/lock graph/SRI,
actual dual-audit exit0, originalUAT byte hash, unchanged major framework pins,
and full exact-head Node22/24 CI including actualPG17/browsers/all steps.

## Review Focus

Actual path elimination versus merely renaming a vulnerable package; Bun/npm graph
agreement and consumer compatibility; unrelated/direct resolution drift; existing
Lovable bridge/HMR/source-tagging and Nitro/server/cron behavior; package integrity
and age; no self-links/file paths, forged migration/receipt, audit exclusions or
weakened gates; historical successful audit snapshots versus current advisory;
original50UAT/productionNO_GO and incomplete B09 accurately preserved.
