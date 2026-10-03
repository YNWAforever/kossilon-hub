# R00 / F22 / UC27: formatter parity

Source baseline: `6f0a851a5826030eca903d86f5d7a22b8331a46c`.
Environment: Windows isolated source archives; Bun 1.4.2, Node 22.23.3 / npm 10, and Node 24.18.0 / npm 11.16.0. Each install started with an absent `node_modules` directory.

| Install | Resolved root Prettier | Install | Actual lint | Actual typecheck |
| --- | --- | --- | --- | --- |
| Baseline `npm ci --ignore-scripts` | 3.9.9 | 0 | 1: 75 errors, 1 warning | 0 |
| Baseline `bun install --frozen-lockfile` | 3.8.3 | 0 | 0: 0 errors, 1 warning | 0 |
| Fixed `npm ci --ignore-scripts` | 3.8.3 | 0 | 0: 0 errors, 1 warning | 0 |
| Fixed `bun install --frozen-lockfile` | 3.8.3 | 0 | 0: 0 errors, 1 warning | 0 |

The four rows ran on Node 22. Both independently installed fixed trees also ran actual `npm run lint` and `npm run typecheck` on Node 24: all four commands exited 0. Node 24's own Linux clean installs remain an exact-head CI gate. The existing Fast Refresh warning at `src/routes/work-queue.tsx:41` remains visible.

Pin only the root formatter to 3.8.3 in the manifest and both locks. Preserve the router generator's separate 3.9.9 dependency; a global formatter override was unnecessary. No source files were reformatted and no lint rule was relaxed.

The portable npm CI step now archives the complete tracked source into an empty directory and executes npm install, lint and typecheck there. Both Node 22/24 legs retain the original migrations, reference seed, full tests, browser tests, build, dev import, audits and compiled scheduler checks. Root `bun install --frozen-lockfile`, `bun audit --audit-level low`, and `npm audit --audit-level low` each exited 0; Bun checked 675 packages and npm reported 0 vulnerabilities.

Machine receipt: [2026-10-03-r00-formatter.json](evidence/2026-10-03-r00-formatter.json). Original failing logs are retained in the owned local `audit-oct3-execution` directory, with hashes in the receipt. These are local configuration checks, not provider, business, staging or production acceptance. No production operation was performed.

Rollback: normally revert this PR. Reverting restores the reproduced npm failure, so require both installer paths to pass before any replacement formatter update.
