# Document Quarantine Runbook

## REQUIRES EXPLICIT APPROVAL: Provider validation flow

1. Create an upload intent with a same-company UUID, approved category, matching extension and MIME, size, and SHA-256 checksum.
2. Finalize the upload into private R2 storage.
3. Confirm the intent is `quarantined` and the object has checksum, size, and content-type metadata.
4. Run the deterministic scanner in local verification or the separately approved malware provider in staging.
5. Confirm genuine clean results bind the current version UUID, actual SHA-256 and byte count. Zero byte, truncated/encrypted PDF, missing configuration and invalid responses must remain unavailable. Retryable failures retain their reason and bounded backoff.
6. Rejected objects remain isolated for attributable investigation; the scan worker does not delete them. Any later destruction needs a separate approved retention process. Confirm ordinary download/preview (including Admin) cannot serve unknown, quarantined or rejected evidence.
7. Verify download recomputes the bytes' hash, checks current lineage and reauthorizes after storage reads. No public storage URL is exposed. Review must send the version the user inspected; a replaced version returns `409 version_conflict` and requires reload.

Use deterministic local storage and scanning by default. Approval is required before enabling a real malware-scanning provider, uploading real client documents, or changing R2 retention.

## Security probes

- Try a wrong-company intent and download; both must be rejected.
- Try a public or metadata-less object; download must be rejected.
- Try a mismatched checksum or MIME; finalization must not advance state.
- Repeat a rejected replacement and verify accepted documents remain immutable.
- Pause the scanner, supersede V1 with V2, then let the old result return. It cannot mark V2 clean. Reclaim a job; the old attempt cannot write a verdict after the new attempt owns it.
- Approve V1, replace with V2, and confirm V2 is pending even while historical V1 decisions remain in the database and audit history.

## Additive migration 0076 and release order

The candidate adds nullable `scan_document_version_id`, scan-job `document_version_id` and `reviewed_document_version_id` plus a scan-job version index. It certifies no historical record. Local source has 44 migration IDs through 0076; the last observed production ledger has 66 historical IDs and a different 0034 alias. These are separate histories; do not fabricate or renumber the production ledger.

1. DB/release owner reviews the complete reconciled migration bundle, populated rehearsal, backup/restore and catalog preconditions. This candidate has no production SQL or deployment approval.
2. Pause maintenance claims for rollout; apply approved additive DDL before deploying the compatible candidate. Preserve all bytes, decisions, jobs and history.
3. Legacy NULL identities remain unknown. To rescan, explicitly enqueue the exact current version through the authorised existing single-document flow. A newly configured provider does not certify earlier deterministic verdicts.
4. Verify clean and rejected controlled staging samples, timeout/429/invalid response, duplicate claims, V1/V2 and current-role download/review, with correlated genuine provider evidence.
5. Resume only the reviewed scheduler owner after provider and release gates pass. A manual local drain is not scheduler acceptance.

### Rollback

Keep additive columns, identities and history. Pause claims/uploads that depend on the candidate, retain quarantined objects and fix forward. A rollback must use a reviewed build with the same fail-closed byte/version/authority gates; the previous Admin unknown-file download behavior is unsafe and is not an acceptable rollback. Do not clear markers, replay unknown sends, reset/reseed, delete rejected bytes, or rewrite migration history. A production restore or retention change requires its own explicit authority.

## Pre-pilot blocker

Malware-scanner readiness remains blocked until the separately approved provider validation flow is available. Local deterministic scanning and private-storage behavior can be verified offline; the dry-run verifier does not upload documents, call a scanner, or mutate R2.
