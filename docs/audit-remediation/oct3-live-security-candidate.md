# R01 / F21 / UC26: actual-live security candidate

Base is the observed deployed artifact `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`, Vercel `dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`, not current main. Production alias remains on that base. Source-lock inspection is not a deployed SBOM; actual deployed resolved package/runtime versions remain unverified.

Official advisories refreshed on 2026-10-03:

- [TanStack GHSA-qx66-fv34-fjm8](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8): patch React Start 1.168.60 and server-core 1.169.39. No live exploit was attempted. Header or browser-navigation workarounds do not replace the patch.
- [PDF.js GHSA-hq66-cqwq-w95j](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j): patch 6.2.108. Its exploit conditions are not asserted to exist in this deployed application.
- [Vitest GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9): the first candidate audit exposed two moderate dependency nodes at 4.1.9; patch to 4.1.11. Dev-server risk is distinct from production exploitability.

## Minimal scope

Patch the dependency/lock graph and the upstream unknown-error root boundary contract. Regenerate the existing route types without adding routes. Copy the two existing regression contracts from main, with ordinary JSON GET/POST success characterization. Pin Bun 1.4.2 and keep every original CI gate, adding strict Bun/npm audits and required Node22/24 legs. No migration, domain, Auth, storage, outbox or provider feature is copied from main.

## Actual local evidence

- Installed vulnerable transport: 4 failures / 2 passes. Patched security/root contracts: 2 files / 11 passes.
- Router unknown/null error contract initially failed 2 tests; minimal upstream type/message compatibility fix made it green.
- Candidate audits after the Vitest patch: Bun checked 672 packages with no vulnerabilities; npm reported 0; both low-threshold commands exit 0.
- Owned fresh PG18.6 database: full original suite 177 files / 1763 passes / 0 skips.
- Actual lint 0; initial newly added test typecheck failed on a zero-argument mock tuple, corrected without weakening the assertion; final typecheck 0.
- Real build 0; compiled Cloudflare scheduled hook present. Dev import gate first timed out on the first cold route while another full suite was competing; unchanged repeat passed all 12 routes, with no import-protection error. The initial failure is retained. Exact-head Linux CI still required.
- Offline firm verifier exits 0 for local contracts while explicitly reporting provider and runtime blockers; it does not authorize a release.

Both npm10.9.9 lock updates failed inside Arborist peer resolution, including an empty directory. Clean npm11.16.0 resolution succeeded. Failures are retained; CI still must prove both runtime legs. No audit exemption or installation gate was removed.

Machine receipt includes installed dependency versions, lock hashes and retained log hashes. This candidate's fresh source-schema fixture is not the historical deployed database. Same-schema hosted preview, fresh Auth and actual read-only core smoke still require an approved isolated target/identity and deployed SBOM/build receipt; no production credential has been inferred and no provider activated.

## Release / rollback gate

Review against the dedicated live-SHA maintenance base, not a PR that downgrades main. Do not merge current main's schema changes into this security candidate. Before any production promotion, verify approved exact artifact SHA, deployed resolved versions and same-historical-schema preview contracts. Keep dispatch off and compare independent scheduler identity. Roll forward to a tested patched compatible build on failure; the known-vulnerable base is not a normal security rollback target.
