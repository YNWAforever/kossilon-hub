# Raw evidence packaging

Initial delivery verifier passed 108 manifest files + 2 metadata files. The first local evidence commit stopped before commit at its newly added blanket `git diff --cached --check`: CRLF was treated as trailing whitespace, and captured failure logs contain original trailing spaces / blank lines. This is a packaging-policy failure, not a product or test failure. Exact repeated raw diagnostic output is retained in `packaging-whitespace-failed.txt` and its checksum receipt; the old script is retained as a snapshot.

Raw CSV, JSON receipts, log text and source snapshots are preserved byte-for-byte. Authored md/mjs/ps1 files receive the whitespace check with command-local `cr-at-eol` support. No global Git configuration, source candidate or expected test behavior changes. The previous manifest/report are archived as `*-pre-packaging.*` to preserve the successful earlier verification; they describe the earlier package only. The final manifest/report include these archives and packaging evidence, and are verified anew.

Only this run's staged paths were unstaged for repackaging after verifying every staged path belongs to the exact run prefix. Worktree bytes and unrelated work are preserved. No history is rewritten and no external action is performed.
