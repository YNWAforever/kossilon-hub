# Approved packages and manual returns — T19 / F12

Candidate source: `73c2605` plus the PR09 review fix recorded in the gate evidence. Local contract evidence is distinct from a genuine
scanner verdict, fresh Auth session, successful platform download or destination
receipt. The internal-server connector is unconfigured and inactive.

## Operating facts

| Fact              | Meaning                                                        | Evidence                                                                                                   |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| prepared          | A person approved the current canonical manifest               | Immutable SHA256/payload, approver, creation time                                                          |
| exported          | Verified current bytes and manifest were packaged for download | Export operator/time; this does not prove browser delivery or external submission                          |
| manual_recorded   | An operator attests external upload/submission                 | Operator, actual occurrence time, recording time, reference, note and optional current reviewed attachment |
| provider_accepted | A verified destination port confirmed receipt                  | Reserved; no production command in this candidate produces this fact                                       |
| unknown           | Delivery outcome is not established                            | Inspect genuine receipt or perform manual reconciliation before considering a retry                        |
| NULL              | Historical provenance is unknown                               | Preserved without backfilling a submission, scan or receipt                                                |

The existing `transmitted` enum can accompany a **manual** attestation. Always use
`delivery_fact` and its provenance, never interpret the enum alone as system
transmission or regulatory acceptance. A provider receipt would also not establish
regulatory acceptance.

## Manual journey

1. Finish the existing document scan/current UUID review, party requirements,
   findings and actual payment evidence. AI suggestions alone do not approve.
2. In the production case detail, review the current manifest and explicitly
   confirm approval. The server repeats current identity, scope, readiness and
   version checks. The same manifest request reuses only its active known attempt.
   Withdrawn or returned attempts retain immutable history; explicit reapproval
   creates a new attempt. Unknown and legacy NULL outcomes block release/retry.
3. Export the approved ZIP. The server includes `manifest.json` verbatim and all
   cited requirement/payment versions, using UUID filenames. Each byte source
   goes through the existing authorized download domain, current scan/version
   and SHA checks. After storage IO the entire case snapshot is checked again.
4. Human staff upload externally and record actual time/reference/explanation.
   An optional proof attachment must already have current scan and human review.
   Without a genuine destination receipt the fact remains `manual_recorded`.
5. Register a return against its original immutable manifest. The request carries
   a stable idempotency key; changed facts with the same key are refused. Mismatched
   hashes are recorded as unmatched and cannot be reconciled as matching.
6. Upload returned attachments through the existing document pipeline. Registering
   the return does not change quarantine, scan, review, payment or filing status.
   Unsafe/pending/unknown attachments cannot be reconciled, including by Admin.
   Existing per-document team/case scope is checked for both intake and review;
   case ownership does not grant access to an unrelated shared company document.
7. Compare the manifest and return evidence and record a human reconciliation note.
   Rejection/partial/unmatched remains an exception. Replacement evidence goes
   through scan and current-version human review before a new package approval.
   Existing filing-proof and closure domain gates still apply separately.

The Today return tab reads actual in-scope internal facts, including exceptions
on closed cases. Empty internal records do not establish external health. Locked,
closed, fixture and historical cases retain existing write protections.

## Download transport and bounds

`POST /api/handoffs/export` is routed through the existing server entry. It requires
exact same Origin, bounded strict JSON, a fresh staff session and current case
authorization. The ZIP uses STORE format, UTF-8 paths generated only by the server,
up to 200 versions and 25 MiB total including ZIP overhead. No object keys or bearer
tokens are included. Responses are private/no-store binary streams in 64 KiB chunks.

The [Vercel body limit](https://vercel.com/docs/functions/limitations) is 4.5 MB for
buffered function responses; the [official streaming guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
motivates the binary stream. A local 5 MiB stream contract passes; actual deployment
streaming, memory, duration and reverse-proxy Origin behavior remain staging gates.
An export fact means archive preparation, including when the connection is lost.
There is no automatic submission or retry.

## Schema and deployment preflight

`0080_manual_handoff_provenance.sql` adds nullable provenance, return idempotency
and immutable approval enforcement to existing tables. `0081_handoff_attempt_idempotency.sql`
limits uniqueness to outstanding attempts, preserving cancelled/returned approvals
while refusing unknown outcomes and concurrent duplicate active attempts. Existing NULL facts remain
unknown. Local source now has 49 migration IDs; last observed production has 66
historical IDs, with a separate schema reconciliation requirement. Do not copy
the source ledger onto production or run 0080/0081 against an unreconciled schema.

Prepare a reviewed release backup/restore point and run these read-only preflights
on the specifically approved staging/production target before any DDL:

```sql
select case_id, manifest_sha256, count(*)
from package_handoffs
group by case_id, manifest_sha256
having count(*) > 1;

select count(*) as handoffs, count(*) filter (where transmitted_at is not null) as recorded_transmissions
from package_handoffs;
select count(*) as returns from handoff_returns;
```

Duplicate history blocks the unique index. Investigate it; never delete approvals
to make the migration pass. The migration runner wraps DDL and its ledger entry in
one transaction. A populated synthetic local rehearsal proved preserved NULL
history, immutable approval updates, duplicate rejection with no partial DDL,
and a rollback retaining the original rows. The 0081 rehearsal additionally proves
cancelled history coexists with a new active attempt and legacy unknown blocks
another attempt. It did not restore a production backup.

## Rollback

Prefer rolling back the feature deployment while retaining additive columns and
all approval/return provenance. Pause access to package write/export operations,
preserve current records and audit evidence, and confirm the old UI does not label
manual enum values as provider receipts. A schema rollback after new records exist
would destroy provenance and requires an explicitly approved preservation plan.
The local rehearsal removed only the added trigger/index/columns inside a synthetic
transaction and verified original rows; the whole rehearsal was then rolled back.

## Minimal external blockers

| Dependency                       | Owner                    | Required next evidence                                                                                   |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Fresh staff Auth / persona scope | Identity owner           | Fresh Admin/Manager/Staff/Client controlled sessions and revoke/scope roundtrip                          |
| Genuine safe bytes               | Storage/scanner owners   | Controlled private R2 object, genuine provider verdict bound to UUID/SHA, current human review           |
| Download platform                | Deployment owner         | Approved staging build, actual small and >4.5 MiB ZIP download, valid ZIP/checksum and scoped denial     |
| Internal handoff destination     | Filing/integration owner | Actual protocol, address, rights, idempotency/receipt query contract and controlled recipient            |
| External acceptance / lost ACK   | Filing/integration owner | Genuine staging receipt/reference and timeout reconciliation without duplicate submission                |
| Regulatory receipt / closure     | Business reviewer        | Genuine receipt intake, verified current attachment, filing-proof approval and existing close-case gates |

HANDOFF-01/02 have local fault-injection contracts, but genuine staging acceptance
is blocked. No production SQL, provider calls, deployment, invitation or live
client transmission was performed for this candidate.
