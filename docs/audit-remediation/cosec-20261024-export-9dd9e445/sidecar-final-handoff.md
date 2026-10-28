# UC157 final UI export sidecar handoff

PASS_FOCUSED_UI_FROZEN. No more edits. HEAD 89676dca7be49f4bf65afb44b036fce087934fc4.

Five mocked jsdom interaction cases passed on the exact frozen source/test bytes: CSV filename and native Blob bytes (BOM, Unicode, quoting); rejection creates no Blob/download and explicit retry succeeds; repeated clicks while pending produce one download; late old-job and old-actor results are discarded and the current scope can explicitly export.

The first run remains preserved: 1 passed, 2 product stale-scope reds, and 2 cases affected by one native-Blob test-double harness defect. The harness defect is separate from the product failures. Final focused run: 5 passed, 0 failed, exit 0, empty stderr, maxWorkers=1, free RAM 2.183124542236328 GiB (2344112128 bytes). No broad checks were rerun.

The source guard captures jobId and a scope identity at click; invalidates the scope on job/actor change or unmount; and checks that identity before creating any Blob/download. Source diff: +17/-4. New test: 261 lines / 5 cases. Existing toolbar test is unchanged. All RPC/Auth effects are mocked; no DB/client/network/provider/container/release action was performed.

Frozen SHA256 and byte counts:
- src/components/bulk-selection-toolbar.tsx: a568d87dc63f3c0d712dcb21c3a8f1e33b35a9be4e3049682cfd81c2d8da0f44; 29137 bytes; 786 lines
- src/components/bulk-export.interaction.test.tsx: b8ce663646107a89ae5257b136ba4448abfc5368bbc6fe612f6f5af88c7652f7; 9940 bytes; 261 lines
- src/components/bulk-selection-toolbar.test.tsx: 8a271fafc87d5fee4374a834145e93fd3d83b1d8111690c771fc35d92f50f581; 22610 bytes; 580 lines

Final machine-readable record: sidecar-final-frozen.json. Original failure logs, initial and final source/test snapshots, and final green logs remain separate. The historical initial handoff/green-status records are superseded by this final handoff. Parent owns the pending full unit/type/lint/build gates and SQL evidence.

No more edits by this sidecar.
