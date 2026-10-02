# Document register reconciliation and controlled recovery

## Observed cause and limits

The production read-only inventory at 2026-10-01T07:10:20Z finds 14 documents,
14 versions and zero linked upload intents. The deployed inner join hides these
register rows in the vault. See `evidence/2026-10-01-document-lineage-production.json`.
Business `verified` is retained as historical review; it proves neither an R2
object nor a provider scan. Storage has not been checked. Do not infer company
provenance or missing objects from names, IDs or this join failure.

## Read-only inventory

Use a scoped read-only DB connection and run:

```powershell
bun scripts/audit-document-lineage.ts
```

The CLI opens a read-only transaction, reads at most 500 register entries and
reports truncation. It does not print filenames, keys, contents, recipients or
credentials, and does not fetch bytes. Without a storage observer every object
is `not_checked`. An injected object metadata observer must distinguish absent
objects from permission failures (unknown) and present objects with malformed
metadata (presence is known, content identity is unverified).
`DocumentStorage.head()` alone cannot prove absence, because it also returns null
for objects whose custom metadata is invalid. Never convert that null to missing.

## Controlled additive re-upload

1. An authorised active staff operator chooses the particular register entry in
   the production vault and requests **預覽受控補傳**. The server loads company and
   case scope and applies the same team/owner/reviewer policy as the list.
   Only this explicit preview performs one object HEAD. The private object key
   is removed from the RPC result. Lists never probe storage during render.
   Unknown inspection does not claim no recovery is needed. For a complete DB
   chain, create rechecks actual absence server-side before approving recovery;
   the observer flag is never accepted as client input.
2. Review the source and obtain the real replacement file; record the reason.
   **批准並補傳** creates an intent with the server snapshot token. A lock and token
   check reject stale register/version/intent state. Client recovery is refused.
   Case/document/intent/version locking follows the existing case and scanner
   order. Two-connection Postgres regressions cover recovery versus replacement
   and recovery versus scanner, without replaying a deadlocked operation.
3. Existing upload validation, server byte-size/hash checks, private R2 adapter,
   version creation and quarantine queues handle the new file. Old document,
   version, object key, approval and associations remain unchanged. No legacy
   intent, verified checksum, scan or uploader is fabricated.
4. Timeline records link the source, approved token/reason, intent and received
   new document. Identical approved retries return the existing intent; a
   conflicting pending/received attempt is refused. Finalisation rechecks the
   source token in its transaction and never inherits historical approval.
5. If a result is unknown, retain the intent ID and reconcile its state and
   received document. The UI blocks another attempt. Do not blindly repeat a
   upload/finalise call. A local transport rejection does not prove no DB commit.
6. The new file remains quarantined/pending until genuine current-byte scanning
   and explicit business review. A business owner maps the newly reviewed evidence
   to the requirement using the existing evidence service. There is no automatic
   mapping or replacement of all legacy records.

## Approval, rollback and owners

This package requires no new DDL and performs no production repair. Deploying the
new package and re-uploading real production files require the appropriate release
and per-record business/storage authority. Existing 0067–0069 release gates remain.
Storage owner supplies scoped bucket access and approved samples; security owner
supplies the real scanner contract and credentials; business owner establishes
source and requirement mapping. No provider health is inferred from bindings.

Application rollback is to the prior reviewed build, retaining all register,
intent, version, timeline and queue rows. Do not delete received or quarantined
evidence or reset tables. For failed pre-finalisation uploads use the existing
expiry workflow only after confirming there is no received document. Received
evidence is governed by quarantine retention and escalation, never intent expiry.
