# R03 follow-up: production aliases must not enter staging UAT

Binding spec: the Oct3 implementation plan's isolated-staging/fresh-role gate and `playwright.audit.config.ts` pre-browser validation. Baseline main `4c00f92a42aa0da3190b4245e129cd22fedef595`; original R00-R11/F01-F22/50UAT IDs and provider blockers remain unchanged.

## Task 1: close the known production-host alias gap

1. Reproduce against the real `auditStagingTarget` function with complete synthetic controlled-account inputs. Known `www.kossilon-hub.vercel.app` and DNS terminal-dot variants must throw before any browser/network work. A distinct staging hostname must remain usable. Run the focused existing unit file first, then add the regression and watch RED.
2. Apply the smallest hostname fence for the two known production hosts and their terminal-dot spelling. Keep exact HTTPS origin, approval reference, build SHA, distinct controlled identities and secret-free output checks.
3. Run focused GREEN, real npm lint/typecheck, and the complete suite on the existing owned loopback PG18 fixture. Keep failures and counts. Run all unchanged remote Node22/24 CI gates on the final published head before any normal source merge.
4. Append `BUG-R03-01` evidence to the delta/status/environment/12-row tracker, without replacing old evidence or changing the original50 UAT/frozen SQL/manifest. Commit, obtain one fresh whole-branch review, publish a reviewable PR and use standing normal green-only merge authority. Hosted release stays NO_GO.

Expected: baseline focused2PASS; new RED4FAIL/3PASS; final focused7PASS0FAIL0SKIP. Full-suite count must be taken from actual output, not inferred. Owned loopback test fixtures are permitted; no hosted SQL/provider/credential/production/browser operation.

## Review Focus

Production bare/www hosts, uppercase URL spelling and DNS terminal dot; avoid broad substring/suffix matching that rejects a distinct staging host. Existing origin/identity checks and output redaction must remain. This fence does not discover every production alias or prove provider isolation; those owner/runtime gates remain blocked. Review the real pre-browser config consumer and all preserved acceptance bytes, not only the changed test.
