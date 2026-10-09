# R01 F25 final branch review

One fresh gpt-6-astra/high read-only reviewer: d8c9312ba84778bbfb4268cfb1d69ec80949e923 → b844452a417d737f178d44db7eaf52ac1b0ee574.0Critical/0Important/1Minor; no source fix pass or second review. Suitable for draft PR and exact-head CI. RuntimeNO_GO remains.

Reviewer independently verified300 protected file hashes/34 source migrations, all38 stdout/stderr hashes, manifest/both locks/CI/new test hashes, live-source ancestry and retained CI bytes. Both actual Nitro LRU driver imports/store/read/eviction passed; both resolve peer^11.2.6 andLRU11.5.3, npm Babel retains5.1.1. Extra YAML/security compatibility checks8/8 each were reviewer-only checks, not added to the product-suite1773 count.

## Rulings I made

- Use manually registered Windows worktree and scoped helpers because native task-root registration lacks a Git repo; cost: explicit path/BASE/owned-resource guards instead of managed attachment.
- Keep3e5eb75's independently native-generated locks, not main locks; cost: separate full installation/integration evidence, preventing schema/version drift from an unrelated base.
- Explicitly declare the compatibleLRU11.5.3 patch over this baseline11.5.2; actual optional-driver contract and >24h publication receipt verify it. Cost: one bounded additional patch version requiring both installer/runtime contracts.
- Add one isolated npm install/lint/typecheck/ten-test CI step; retain every old gate/matrix/threshold. Cost: an additional short install per Linux runtime leg.
- Reviewer set aside rerunning install/fullPG/DOCX/cleanup: accept38 actual hash-matched command logs plus independent live-driver checks for review; exact-head CI still required. Cost if wrong: mistaken local provenance, mitigated by protected hashes and separately observed CI.
- Reviewer set aside remote Linux/Node22/24/PG17 CI: wait for this candidate's own run, no reuse of main R13 CI. Cost if ignored: false portability claim.
- Reviewer set aside production physical schema, deployed dependency contents, scheduler/native ticks and real Auth/provider/filing: keepruntimeblocked/releaseNO_GO and owner inputs. Cost if ignored: unsafe formal promotion.
- Reviewer set aside historical P1v6 refresh: retain dated consumed/expired evidence, don't repeat its attempt/claim/suspend. Cost if ignored: unauthorised operation or false current-state claim.

## Deferred minor

Spec line5 callsLRU11.5.3 existing; this branch baseline actually11.5.2. Implementation receipt/report explicitly record11.5.2→11.5.3 and its exact installed-driver tests. Preserve the review's minor as deferred under the one-review rule; no extra code/doc fix pass. Existing work-queue warning and Argparse compatibility deprecation remain non-blocking.
