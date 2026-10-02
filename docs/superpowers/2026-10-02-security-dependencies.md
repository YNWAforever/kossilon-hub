# B03: remaining audited dependency fixes

Spec: the user's 2026-10-01 implementation assignment and
`docs/audit-remediation/security-triage.md`. This is an additional concrete bug,
following completed T00–T23 local source work. Original F01–F20 and all 50 UAT
requirements remain intact.

## Global constraints

- Base: PR11 `8b834f48b11d4dbdbc81959ec5b01804ab7320d7`.
- Isolated branch: `codex/security-dependency-remediation-20261002`, existing
  linked worktree `audit-t03-readiness-worktree`.
- Preserve pinned TanStack, Better Auth, PDF.js and Lovable architecture/history.
  Patch the 13 packages actually identified by Bun audit; no blanket force fix,
  new direct framework dependencies, release-age exclusions or security bypass.
- Use official npm metadata and upstream advisories. Installed Bun 1.3.14
  behavior must be verified; current Bun documentation describes newer releases.
- No production SQL, environment writes, deployment, merge, invitations or sends.
  Local synthetic parser fixtures are not genuine scanner/provider acceptance.
- Original UAT counts remain 19 LOCAL ONLY pass / 31 blocked. Release stays NO_GO
  for unresolved production schema, Auth, providers and acceptance gates.
- One fresh whole-branch reviewer, then one Critical/Important RED/GREEN fix pass.

## Task 1: patch audited resolutions and verify parser compatibility

Interfaces: package.json, bun.lock, package-lock.json, existing mammoth browser
DOCX boundary, dependency audit CI gate. Produces a compatible tested dependency
tree and reproducible actual before/after audit results for Task 2.

1. Retain actual `bun audit --json` RED (13 packages, exit 1); capture npm audit
   and installed parent/range inventory. Verify patch versions and release dates.
   Expected: real vulnerable resolutions and official patch floors, not assumed
   application exploitability.
2. Measure the bounded upstream many-attribute XML case using the installed
   parser (2k/4k/8k/16k/32k, timeout); add an actual synthetic DOCX browser
   extraction compatibility regression through existing parseFile.
   Expected: real preserved text/chunks and measured CPU evidence; no mocked
   parser, scan result or flaky wall-clock threshold in CI.
3. Resolve patches within the existing parents' compatible ranges, retain both
   brace-expansion majors and the unaffected esbuild 0.25 tree. Validate any
   package-manager syntax in isolated scratch before changing the real manifest.
   Synchronise both tracked locks and add actual Bun/npm audit CI gates.
   Expected: both audit commands exit 0 with zero known package advisories;
   frozen install succeeds, direct dependency set and framework pins retained.
4. Run actual DOCX/PDF browser regressions and targeted affected tests/typecheck.
   Repeat bounded XML measurement and record version/environment/command/data.
   Expected: compatibility passes, actual before/after numbers, no runtime claim.
5. Commit a focused Conventional Commit with source, locks and regression.
   Completion command: both audit commands plus browser parser regressions.

## Task 2: full verification, review and reviewable delivery

Dependencies: Task 1. Interfaces: patched dependency tree, original CI, existing
release ledger and environment matrix.

1. Run the complete existing CI with actual Node22/Postgres17 and local browser,
   including frozen install, migrations/seed in the dedicated local DB, lint,
   typecheck, all tests (explicit skip count), offline gates, browser, build,
   dev imports and compiled scheduled hook.
   Expected: actual all-green local output; existing lint warning explicit.
2. Perform one fresh branch review, record scope/declined behaviors/rulings.
   Reproduce and fix Critical/Important findings in one pass, then rerun required
   affected gates and the full suite for concrete remaining risk.
   Expected: no unresolved Critical/Important; no repeated review loop.
3. Commit evidence/security-triage/status/environment updates. Preserve original
   50 UAT expectations/results and historical performance artifacts.
   Expected: factual counts, unchanged migration/production state and NO_GO.
4. Push the isolated feature branch and open/attach a draft PR stacked on PR11.
   Verify actual remote CI/preview before delivery; never merge the draft stack
   based on an old authorization for a different candidate.
   Expected: reviewable PR, exact verified build/source/results and next owners.

Completion command: complete local CI gates and `npm run verify:audit-release`;
remote outcomes recorded separately.
