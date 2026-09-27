# T12 document lifecycle: local evidence and release gate

T12 extends the existing UploadIntent, DocumentVersion, ScanJob and annual-return evidence review services. It adds no schema or alternate review path. A received upload is now read back from private storage and hashed before its intent can advance to quarantine. The live scanner hashes stored bytes, checks the declared PDF/PNG/JPEG signature and submits those bytes to the configured vendor. Only a provider `clean` result with a matching verified SHA-256 and byte size can make a file safe for ordinary staff or client access. A deterministic local verdict remains `unknown` and cannot authorize review. Failed, timed-out and unavailable scans never become clean.

The repository writes a clean provider verdict and the current version's verified identity in one transaction. A missing, mismatched or conflicting identity rolls the verdict back; the intent remains quarantined or its prior state. Review locks the document and upload intent, checks current version, verified byte identity and expected version, and records the human decision only then. Both the generic document action and the annual-return evidence action pass the version seen by the reviewer. Additive same-file uploads create a new document and pending review; they do not inherit the earlier review. Requirement read models and document analysis now use verified current-version identity. Filing receipt acceptance also requires genuine scan safety.

Every server-mediated download rechecks authoritative company/case scope, scan safety, private object metadata and the hash/size of the returned body. This architecture does **not** issue signed R2 URLs: the T12 expired-link concern is enforced as an expired UploadIntent and a fresh authorization check on every private download. The client has no direct R2 URL to reuse. Admin unknown-safety incident access remains the existing narrow policy; an unknown file cannot receive a new business approval.

## Local RED and GREEN evidence

The named `document-lifecycle.integration.test.ts` RED run reproduced four cases: fake PDF bytes received a clean verdict, provider clean without a stored-byte identity became available, a stale expected version did not stop review, and corrupted download bytes passed metadata checks. One initial stale-version test used an incomplete mock and was replaced with a real-Postgres fixture before GREEN. The final fixture also proves duplicate content creates a second pending document, a foreign client is denied before storage access, an expired intent cannot finalize, and authorized staff can view a matching file. Existing live-scanner tests cover provider malware, timeout, unreadable object, checksum mismatch, 401/503 and malformed response. The suite's shared-Postgres file list was updated so the new fixture runs serialized.

Final local gates: 194/194 Vitest files and 1784/1784 tests passed with disposable PostgreSQL, including the serialized T12 database fixture. Typecheck and build exited 0. Lint exited 0 with one pre-existing Fast Refresh warning in `src/routes/work-queue.tsx`. All 13 dev-server route import checks passed. Local `db:inspect` reported `ledgerState=current`, no missing/unknown/mismatched migration and `canRelease=true` for the **disposable database only**. `verify:firm --dry-run` made 38 reads, 0 network calls and 0 writes; database, storage, malware scanner, messaging, backups, browser evidence and live bindings remained BLOCKED.

No production object, recipient or database was touched. The disposable PostgreSQL 17 database carries migrations 0001-0039. T12 adds no migration. A provider's actual non-sensitive clean/reject sample, R2 readback and authorized staff/client verification on the deployed runtime are still required before `runtime-verified`; no scanner vendor, endpoint or API key has been supplied. No fixture verdict is presented as provider evidence.

## Release and reversal

Before an authorized deployment, verify the target database binding and reconcile the T00 legacy ledger and absent production migrations 0021-0039. With read-only SQL, count `available` provider rows whose current `document_versions.verified_checksum_sha256` or `verified_byte_size` is null or disagrees with the upload intent. They will read as unknown safety after this change and need a genuine rescan, never an inferred hash. Confirm private R2 binding, scanner provider contract and a non-sensitive approved sample. Observe a real upload through quarantine, provider clean or reject, staff review and scoped download; separately test timeout and object read failure. No production write, migration, provider call or release is authorized by the current assignment.

The read-only preview query for that review is:

```sql
select count(*) as provider_available_without_verified_identity
from document_upload_intents i
join documents d on d.id = i.document_id
left join document_versions v
  on v.document_id = d.id and v.superseded_by_version_id is null
where i.status = 'available'
  and i.scan_verdict_source = 'provider'
  and (v.id is null
       or v.verified_checksum_sha256 is distinct from i.checksum_sha256
       or v.verified_byte_size is distinct from i.expected_size_bytes);
```

This is a count only. Inspect affected IDs and vendor references in the authorized target after binding is verified; do not backfill identities from client-declared fields.

There is no SQL rollback for T12. If code reversal is required, stop new reviews and downloads first, retain UploadIntent/DocumentVersion/ScanJob rows and vendor references, and return only through a reviewed code release. Never restore the previous behavior that considered provider `clean` alone sufficient to release or approve bytes.
