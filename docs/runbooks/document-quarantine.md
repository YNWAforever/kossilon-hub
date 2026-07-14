# Document Quarantine Runbook

## REQUIRES EXPLICIT APPROVAL: Provider validation flow

1. Create an upload intent with a same-company UUID, approved category, matching extension and MIME, size, and SHA-256 checksum.
2. Finalize the upload into private R2 storage.
3. Confirm the intent is `quarantined` and the object has checksum, size, and content-type metadata.
4. Run the deterministic scanner in local verification or the separately approved malware provider in staging.
5. Confirm clean files become `available`, rejected files are deleted, and retryable failures remain quarantined.
6. Verify downloads require current Neon Auth authorization and never expose a public storage URL.

Use deterministic local storage and scanning by default. Approval is required before enabling a real malware-scanning provider, uploading real client documents, or changing R2 retention.

## Security probes

- Try a wrong-company intent and download; both must be rejected.
- Try a public or metadata-less object; download must be rejected.
- Try a mismatched checksum or MIME; finalization must not advance state.
- Repeat a rejected replacement and verify accepted documents remain immutable.
## Pre-pilot blocker

Malware-scanner readiness remains blocked until the separately approved provider validation flow is available. Local deterministic scanning and private-storage behavior can be verified offline; the dry-run verifier does not upload documents, call a scanner, or mutate R2.
