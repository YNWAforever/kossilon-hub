# R22 continuation — authored local-demo keyboard/reflow regression

Status: **READY_FOR_PARENT_RUN (authored/static checks only); browser NOT RUN.**

Workspace: `C:/Users/laich/Documents/kossilon-hub/cosec-20261023`.
Branch/HEAD inspected: `codex/cosec-20261023` / `717ee08cfdfb6dc819d2105d8152b153207c9e03`.
Prior tested product source supplied by the parent: `e8ecf3fad979adc4321a58eb64a90d0927e175de`; no earlier browser result is claimed for this new test.
Runtime source was clean on intake. The existing untracked continuation receipt directory and its `intake.json` were preserved.

Only these three paths belong to this sidecar:

- `e2e/continuation-reflow.spec.ts` — one Playwright `test`, with sequential Admin/Staff steps and local helper functions in the same file.
- `playwright.local.config.ts` — one additive `testMatch` entry; existing projects, evidence guard, runner and tests are retained.
- `docs/audit-remediation/cosec-20261023-cont-d55d8d7e/R22-reflow.md` — this receipt.

No `src/**`, DB registry, other existing test, dependency, historical evidence or parent receipt was edited. No commit, network request, installation, browser/server/DB instantiation, provider call, real message, payment, push, merge, deployment or production operation was performed by this sidecar. Discovery used the already-authorized local-source fallback; graph indexing/upload was not retried. Workflow: `product-development-execution`; verification used `verification-before-completion` within the static-only authorization.

## Source boundary and fixture identity

The requested actual **client record → annual-return detail → client return** journey is **BLOCKED_IN_DEMO**. `src/routes/clients.tsx:40` and `src/routes/clients.$id.tsx:18` branch to `DemoClientNotice`; the register/detail messages in `src/features/clients/components/demo-client-notice.tsx` explicitly say no demo company data exists. `ClientWorkOverview` and its client-context return links belong to the production branch. No fake client record, helper application, mocked backend, fabricated client-to-case relationship or native session was introduced.

The existing `DemoUnavailable` component offers the genuine link `瀏覽周年申報案件` to `/annual-returns`. The test asserts the client notice, absence of a client table/detail links, and uses that fallback. **This is not proof of client-record navigation or client-context return.** Both client demo routes were inspected; only the register notice is exercised by the authored browser scenario.

The actual demo board links to `/annual-returns/ar-delta`. `src/lib/annual-return-store.ts:399` defines that fixture as **Delta Bloom Ventures Limited**, contact **Joanna Poon**, phone **+852 9333 2211**, owner **Iris Wong**, `waiting-documents`, missing `Signed NAR1` and `Updated significant controller register`, payment `pending`, signature `requested`, review `not-started`, empty notes and the `Case seeded` timeline event. `demo-case-detail.tsx` renders those fields, disables action/select controls, exposes a read-only note and returns to `/annual-returns`. Expected values in the regression are independent literals grounded in this source; the test imports no application/store modules.

## Precise parent-run scenarios

The single test runs in both existing projects (`mobile390` and `desktop1280`). Each starts at its configured viewport for login/client notice, then explicitly switches to **640 × 450 CSS px** and repeats the fixture journey for **Amy Chan/Admin** and **Mei Lam/Staff**, signing out between personas through the existing UI. Explicit `/login?redirect=%2F` prevents the previous persona's remembered deep link from changing the next landing. There are no skips, conditional role-coverage omissions, assertions weakened in existing tests, mouse clicks or programmatic `.focus()` calls.

| Scenario | Expected observations/assertions |
| --- | --- |
| Keyboard entry and role identity | Tab/Enter activates the actual demo identity button; dashboard appears; account block contains the exact name and role. Admin has `用戶管理`, `設定`, `月表匯入` links; Staff has none of those links. |
| Client demo boundary | Keyboard navigation reaches `/clients`; its real no-demo-data notice appears; no client table or `/clients/…` record link is present. Geometry is checked at the project's initial width and 640 CSS px. |
| Drawer focus | At 640 CSS px, Tab/Enter opens the actual drawer. More than one full link/sign-out/close cycle stays inside the dialog; Escape closes it and restores visible keyboard focus to the trigger. |
| Existing fallback and board row | Tab/Enter follows `瀏覽周年申報案件`; keyboard typing searches `Delta Bloom`. Exactly one case link remains, with href `/annual-returns/ar-delta`; its actual row contains Delta Bloom, Joanna Poon, Iris Wong and `付款：待付款`. |
| Actual case detail | Tab/Enter opens the case. Exact company/contact, both missing documents, owner/status values, empty notes and seeded timeline must render. More than ten action/select controls must exist, all disabled; filing, receipt acceptance and adding a note are explicitly disabled. |
| Read-only keyboard and reload | After asserting native `readonly`, Tab reaches the note; typing `R22 read-only probe` leaves its value empty. Reload keeps the same case URL, fixture values, disabled controls and empty note. All select/textarea values and disabled states equal the pre-reload snapshot. No saved write is claimed. |
| Return | Tab/Enter follows the detail's actual `返回` link to `/annual-returns`. The real Delta row/contact/pending payment remain available. The demo's component-local search resets to empty; URL-filter/client-return persistence is not claimed. |
| Admin access / Staff denial | Admin uses the real `用戶管理` nav link; Amy's displayed role is Admin and its role/deactivate controls are disabled. Staff directly loads `/admin`, sees `須具備管理員權限` and its own identity, with no user table, combobox or action button; keyboard navigation reaches `返回總覽` and returns to the dashboard. Denial geometry is checked before returning. |
| Reflow and errors | Client notice, board, detail, reloaded detail, returned board and access/denial surfaces must fit the 640 CSS px page width. Document/body horizontal overflow fails; heading and focused actions must remain horizontally contained. Each activated target must be focused, in the viewport, match `:focus-visible` and have an outline/shadow cue. Page errors/Vite overlay or any unexpected browser request fail. |

The browser request guard allows only GET/HEAD on the configured `http://localhost:5180` or `http://127.0.0.1:5180` origin. Other requests are aborted and recorded as failures; no response is fulfilled or mocked. This browser guard **does not establish server-side DB isolation** or authorize any server activity. The parent owns all environment/process identity gates and execution. Settings/provider surfaces are not opened.

**640 CSS px is the reflow space equivalent to a 1280px layout at 200%; this test never changes actual browser zoom, CSS zoom, device scale factor or native Auth.** Physical devices, Safari/WebKit, screen-reader behavior, independent contrast measurement, full native role/API/RLS acceptance and the actual client-record round trip remain **NOT RUN / BLOCKED_NATIVE**, and are not closed by a future demo pass.

## Static verification actually performed

All commands ran from the exact workspace above with existing local dependencies:

```powershell
node node_modules/eslint/bin/eslint.js e2e/continuation-reflow.spec.ts
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --types node e2e/continuation-reflow.spec.ts
node node_modules/prettier/bin/prettier.cjs --check e2e/continuation-reflow.spec.ts
git diff --check -- playwright.local.config.ts
```

Final-file ESLint, isolated TypeScript and formatting checks each exited **0**. The config diff check exited **0** and its diff is exactly **+1 / -0**. The normal application `tsconfig.json` excludes `e2e`, so the explicit isolated compiler invocation checks the new spec; no whole-app typecheck, unit suite, Playwright collection, runtime RED/GREEN, browser, dev server or DB test was run. Static success is not a browser pass or a verified regression result. Command evidence is in this sidecar's tool output; no additional log paths were created.

Frozen source fingerprints (SHA256, after the final static checks):

```text
F12EFC9A63F8C898180FB5DD328D0019AF74A7DFCD72959919C5B572C0A12B07  e2e/continuation-reflow.spec.ts
C6223D14F419E26DB46E4B15464339202BCEE0CE094017DB711B1AF5FF373D3C  playwright.local.config.ts
```

## Parent-owned execution handoff

After the parent verifies its local demo server/environment identity and available installed browser/channel, run only this new file with the existing guarded config:

```powershell
node node_modules/@playwright/test/cli.js test --config=playwright.local.config.ts e2e/continuation-reflow.spec.ts
```

This command is **provided, not executed**. It selects the one authored test in both existing projects; the parent owns any execution, browser-channel selection and result classification. The config enables demo mode for its local web server, binds localhost port 5180, retains its existing reuse policy, and allocates a fresh `.worktrees/local-browser-runs/run-*` root printed as `[local-browser-evidence] run root: …`. Verify any reused server is the authorized demo source; a localhost address alone is not isolation proof. No installation is part of this handoff.

Expected parent-generated evidence under that fresh root: `results.json`; per-test artifact paths from `info.outputPath` for `Admin-clients-640.png`, `Admin-case-640.png`, `Admin-reload-640.png`, `Staff-clients-640.png`, `Staff-case-640.png`, `Staff-reload-640.png`, and `Staff-denial-640.png`; failure screenshots/traces according to the unchanged config. These artifacts do not exist as a result of this sidecar. Preserve failed assertions and their evidence for parent triage; do not relabel failures as native acceptance or replace the missing client journey with a helper app.

Parent should bind the actual run to current HEAD, these source fingerprints/dirty diff, browser/channel and exact output root. Parent independently owns the 500-row SQL work and aggregate/release records. This sidecar is **frozen for parent review/run**; no runtime or release gate is declared passed.
