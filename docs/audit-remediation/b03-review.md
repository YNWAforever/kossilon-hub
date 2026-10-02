# B03 sole fresh review — 2026-10-02

Read-only GPT-6.1 Sol review of base `8b834f4` through `944f703`, all eight changed
files, both locks, retained real audit/install/parser evidence and consumer ranges.
No code graph export, source mutation, production operations or competing PG tests.

Critical0 / Important1 / Minor0. One fix pass; no rereview.

## Important: npm scratch-directory self-link

Reviewed `package-lock.json` added undeclared `tanstack_start_ts: file:../..`, a
parent snapshot and a filesystem link. Earlier `--prefix` install under the
checkout made that reference resolve to the current app, so its passing install
was not portable evidence. It is explicitly **rejected** as a completion proof.

Executor accepted Important: a normal fresh checkout must install only its
declared dependency tree, independently of parent directory contents. Actual
tracked-lock tests reproduced both unauthorized root dependency and filesystem
link (RED2). Regeneration uses the scratch folder as the actual cwd, exact
manifest, original valid npm lock and normal peer validation. The final clean
install, GREEN and full suite are recorded in the B03 gate artifact after they run.

## Declined behaviors and executor rulings

- Production DB/schema/Auth readiness: remains NO_GO pending historical/physical
  reconciliation and fresh controlled Auth. Local patch gives no release authority.
  Cost if wrong: an incompatible release or stale authorization remains possible;
  activation is blocked by existing gates.
- Genuine provider/scanner/upload/email acceptance: remains blocked with existing
  named owners. Actual synthetic parsing and audit output do not prove integrations.
  Cost if wrong: quarantine/transport/provider failures remain undiscovered.
- All50 runtime UAT: preserve19 LOCAL ONLY pass /31blocked, no promotion from local
  CI. Cost if wrong: a real business journey remains unaccepted; release stays NO_GO.
- Comprehensive hostile DOCX/PDF corpus/archive bombs/every malformed XML exploit:
  patch known advisories and exercise actual compatibility/YAML budget/bounded XML;
  genuine corpus acceptance remains an external security/business gate. Cost if
  wrong: other parser/resource defects can remain; no blanket safety claim.
- Bun1.3.14 compatibility: intentionally require fixed1.4.2/v3 lock; keep24h guard.
  Cost if wrong: an environment using an old installer fails; exact platform
  installation/build verification is required before release.

Reviewer assessment: with the npm fix and required verification. Linux CI and
owner's final full suite are separate evidence, not established by review.

## Execution rulings carried from the ledger

- Reuse the existing linked worktree and a new isolated branch: preserves the
  primary checkout/published history. Cost if wrong: an unsuitable worktree could
  mix changes; clean status, exact base and explicit staging were checked.
- Refuse Bun1.3.14 named-transitive updates: the dry-run adds direct dependencies
  and major upgrades. Use scoped compatible overrides instead. Cost if wrong:
  a parser/build compatibility failure; actual ranges/install/full gates required.
- Pin official SHA-verified portable Bun1.4.2 and CI/packageManager together:
  old1.3.14 ignores scoped rules. Cost if wrong: old-platform install failure;
  platform verification remains mandatory, release-age guard unchanged.
- Isolated npm12.2.0 may resolve the reproduced npm10 Arborist bug; do not change
  global tools or bypass peers. Cost if wrong: malformed lock, so npm10 normalize
  and actual clean install are required. First incomplete lock was rejected.
- Audit0 and prefix clean-install success do not prove portability: reject the
  first missing-edge lock and reviewer-discovered self-link proof. True-cwd
  generation, manifest/link tests and CI independent install now enforce this.
  Cost if wrong: hidden parent checkout dependency, caught by RED2→GREEN4.
- Add the real independent npm install to CI: catches graph edges that audit
  alone omits. Cost: extra install time; no lifecycle scripts or production effects.

No deferred Minor findings. No second review round.

## Fix verification

7cdc8a0／26ef92d：tracked-lock RED2→GREEN4（2files），true-cwd npm10 install721packages／0advisories；final source26ef92d full230files2183PASS0skip414.52s／ChromeDEMO12PASS30.0s／all14CI gates及compiledhookPASS。證據：evidence/2026-10-02-b03-gates.json。
