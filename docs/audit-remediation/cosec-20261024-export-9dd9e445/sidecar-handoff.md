# UC157 UI export sidecar frozen handoff

Status: FROZEN_FOR_PARENT_VERIFICATION. No more edits by sidecar.

Base HEAD: 89676dca7be49f4bf65afb44b036fce087934fc4. New test: src/components/bulk-export.interaction.test.tsx (5 cases). Minimal source change: src/components/bulk-selection-toolbar.tsx (+17/-4).

The only focused run used maxWorkers=1, an environment whitelist, envDir:false, no repository Vite plugins, and unique ignored scratch storage. Actual free RAM immediately before launch: 1.533664703 GiB (1646759936 bytes), above the 1.5 GiB gate. All server RPCs are mocked, so no Auth or DB client is created. Browser fetch is guarded. No DB/network/provider/container/release action was performed.

Actual run: 1 passed, 4 failed. Pending repeated-click guard passed. Two product failures reproduced stale Blob creation after changing the saved job or actor. Two harness failures stopped the successful-download and explicit-retry cases at the native Blob instance assertion. Original stdout, stderr, JSON test report, preflight, and source/test snapshots are preserved without rewriting.

Prepared repair: capture the selected job and a session/job scope identity at click; invalidate that identity on job/actor change or unmount; skip Blob/download creation for stale results. The constructor double now explicitly returns a native Blob. Filename, actual CSV bytes including BOM/Unicode, URL revocation, no Blob/download on rejection, explicit retry, and repeated pending clicks remain asserted by the five cases.

No green test run has been performed for the repaired files because the user limited this sidecar to one focused invocation. Parent must run the final unit/type/lint/build checks and inspect all five cases. This handoff does not claim the repair passes or any integration/DB/role/financial acceptance.

Static checks: scoped git diff --check passed; both edited files were formatted using installed Prettier. Existing bulk-selection-toolbar.test.tsx is byte-for-byte unchanged. Parent-owned server-fns, result-export tests/SQL, registry, and documentation were not edited.

Frozen SHA256 fingerprints:
- src/components/bulk-selection-toolbar.tsx: a568d87dc63f3c0d712dcb21c3a8f1e33b35a9be4e3049682cfd81c2d8da0f44 (786 lines; 29137 bytes)
- src/components/bulk-export.interaction.test.tsx: b8ce663646107a89ae5257b136ba4448abfc5368bbc6fe612f6f5af88c7652f7 (261 lines; 9940 bytes)
- src/components/bulk-selection-toolbar.test.tsx: 8a271fafc87d5fee4374a834145e93fd3d83b1d8111690c771fc35d92f50f581 (580 lines; 22610 bytes)

See sidecar-classification.json for failure separation and sidecar-frozen.json for exact run/file counts. sidecar-manifest.json fingerprints every other sidecar evidence file at freeze time.
