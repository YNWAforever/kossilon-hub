# Upload reload and lost intent without an id

Reviewed at `fcce28d6b5483bd78bc31c8f32590325f3152d98`. Design only.

`cosec-20261027-upload-receipt-recovery` added `readDocumentUploadReceipt` for a **known** intent id. `cosec-20261027-queue-read-admission` recorded why the staff panel was not given a copied portal journal: recovery combined with `uploadRequestId` is refused, and re-POSTing create would be write replay. This note is the protocol those passes asked for.

## Current semantics

`document_upload_intents.id` is a server UUID. `object_key` is unique (`src/server/db/schema.sql`). There is no client-command column. `requested_by_auth_user_id`, checksum, size, name, content type, case, and category are stored on the intent. `expires_at` is 15 minutes from create for an intent that is still `created`. Status moves `created` → upload lifecycle; `document_id` is set when finalize commits a document.

Two create paths already exist.

**Portal upload** (`src/routes/portal.tsx`, `src/features/documents/upload-resume.ts`). The page mints `uploadRequestId` and writes the journal to `sessionStorage` before `createDocumentUploadIntent`. The server hashes `JSON.stringify([authUserId, uploadRequestId])` into `documents/request-{sha256}` (`createDocumentUploadIntentForActor`). Conflict on `object_key` returns the existing intent when company, case, checklist, actor, category, name, type, size, and checksum all match, and rejects a mismatch without extending expiry. The journal stores the request UUID and file metadata. It does not store the server intent id. Resume re-POSTs create, then finalize. Finalize of an intent that already has `document_id` returns that document after a byte and authority re-check and does not `storage.put` again (`finalizeDocumentUploadForActor`). UC150 states that a different new request stays additive, including another tab, and that a new device or a new tab cannot recover the request id.

**Staff controlled recovery** (`src/features/documents/document-recovery-panel.tsx`). The panel has `documentId` from its props. Create sends `recovery: { documentId, expectedToken, reason }` and does not send `uploadRequestId`. The validator rejects both together. The object key is `documents/{random uuid}` (`createOpaqueDocumentKey`), which the client cannot recompute. Inside the create transaction the repository locks the source document, then selects the latest non-terminal `document_recovery_requested` intent for that source document (`src/features/documents/repository.ts`). Same auth user and same name, type, size, and checksum returns that intent. Any other open recovery throws and does not insert. A new insert also writes `document_recovery_requested` with `metadata.intentId`. The panel sets React `intentId` only after that POST resolves, and it sets `writeStarted` before the await. A lost create response therefore renders "補傳結果未確認" with no intent id and no receipt button.

`readDocumentUploadReceipt` is a GET by intent UUID. It requires active staff, re-checks intent scope, and requires `requested_by_auth_user_id` to be the caller. No `document_id` returns `{ state: "unconfirmed" }`. A document id is accepted only when the existing lineage validator matches version, company, case, category, file, type, size, checksum, object, and status. The body is `intentId`, `state` (`unconfirmed` | `received`), and `documentId` on `received`. No storage, scanner, or repository write.

`listDocumentPage` summaries include `intentId` and `checksum` for **document** rows. An intent with a null `document_id` is not in that list. `getDocumentRecoveryPreview` returns the source document's token and availability. It does not return the open recovery intent id. Nothing in the UI reads `document_recovery_requested` except the create transaction.

## Failure modes

| Case | Durable row | Client handle after reload |
| --- | --- | --- |
| Portal create or finalize response lost, journal still in this tab | Intent under the hashed object key; document row only if finalize committed | `uploadRequestId`. Resume POSTs create again. Receipt GET is unused because the intent UUID was never stored |
| Portal journal gone (tab closed, new tab, storage failure) and response lost | Same server row | No request UUID and no intent UUID. The object key is a hash of a UUID the client no longer has |
| Staff create response lost before `setIntentId` | Intent plus timeline event, in one transaction, when the insert committed. Nothing, when it rolled back | React state is empty. `documentId` is still the panel's prop. Receipt GET cannot be called |
| Staff finalize response lost after `setIntentId`, same mount | Document row when finalize committed; intent still `created` when it did not | Receipt button calls the GET. This is the path already shipped |
| Staff finalize or create lost, then reload | Same as the committed case | `intentId` was only React state. The receipt button is gone |
| Staff retries create by clicking again after reload | Prior-intent query may return the open row, and the panel then finalizes | That is a POST. It inserts a new random-key intent when no open recovery matches. It throws when an open recovery belongs to another file or another user, still without revealing an id |
| Created intent passes `expires_at` unfinalized | Prior query stops returning it (`created` and expired). Cleanup index covers `created` and `uploaded` | A later create is allowed. The expired row is not a receipt of a stored document |

A document-list diff cannot identify a lost create: the intent is not a document until finalize commits. A checksum match on the list cannot identify it either, and additive uploads mean the same checksum may already be a different document. Absence from the archive does not mean the create rolled back.

## Why a local UI latch is insufficient

The recovery panel already refuses another approve click after `writeStarted` in that mount, and it already offers receipt readback once `intentId` is set. Reload clears both. The source `documentId` remains, and the server already knows whether an open recovery intent exists, but only inside the create POST. Calling that POST to "look up" the intent can insert a row when the lookup misses. Copying the portal journal onto the staff panel does not remove that POST, and the server rejects `uploadRequestId` together with `recovery`, so the hashed object key cannot be used for this path today.

Guessing an intent from filename or checksum would attach the wrong additive document or the other user's open recovery. The create path refuses that mismatch rather than returning the other row. A read API has to do the same: no id for an attempt the caller does not own.

## Options

### Recommended: read-only recovery lookup by the source document id

Add a staff GET whose only input is the source `documentId` the panel already has after reload. Authorize it the same way as `previewDocumentRecovery` and `readDocumentUploadReceipt`. Run the existing prior-intent query (latest `document_recovery_requested` for that source document, excluding terminal and expired-created rows). Then:

- No row: `{ state: "absent" }`. The lost create did not commit, or the created intent has expired. A new upload remains a separate explicit approve.
- Row owned by this auth user: return `intentId` and the same receipt state `readDocumentUploadReceipt` already returns (`unconfirmed` or `received`). The client may then call the existing receipt GET. It must not call create or finalize as part of this read.
- When the panel still has the selected file, the GET also accepts that file's checksum, size, name, and content type — the same fields `createUploadIntent` already compares — and returns `{ state: "blocked" }` when they differ. It does not echo the stored checksum. `readDocumentUploadReceipt` does not return those fields, so this comparison has to happen on the lookup. Finalize stays checksum-gated either way.
- After reload, with no file selected, the lookup may report `open` plus `intentId` and receipt state. That tells staff an unfinished recovery exists. It does not authorize sending a newly chosen file under that id.
- Row owned by someone else: `{ state: "blocked" }` with no intent id, no checksum, and no filename. That matches the create path's refusal.

`unconfirmed` means the intent exists and no document is committed. It does not mean the object is in storage, scanned, or approved. `received` means the document lineage matched, which is the same limit the existing receipt copy already states. An explicit later resume may re-select the original file and call finalize; that resume is a write, gated by the user, and it is outside this design's implementation.

Tradeoff: the handle is "the open recovery for this document", not "the click I just made" if product rules ever allow two open recoveries. Today the create transaction locks the source document and keeps a single open attempt, so the document id is stable. The GET does not extend expiry and does not insert. Portal journal-loss is a different hole and is not closed by this GET.

### Minimal alternative: allow a recovery request UUID

Stop rejecting `uploadRequestId` on recovery, hash it into `object_key` the same way as the portal, and persist the UUID before the POST. A GET by that UUID resolves the same hash and returns the receipt.

Tradeoff: the object-key conflict path currently throws when `input.recovery` is set, while the timeline prior-path returns an older intent. Those two lookups would have to be specified together before the ban is lifted, or a replay could reject a request the timeline lookup would have returned. This also adds a client journal the source-document GET does not need, because `documentId` already survives reload. Prefer it only if Willy wants every attempt to carry its own id even when two recoveries of one document must be open at once. That would be a product-rule change, not just a lost-response fix.

### Deferred

Leave the staff panel blocked with no id after a lost create, and tell staff to look at the archive.

Tradeoff: the archive list does not show a `created` intent. The person following that instruction cannot see the row the create committed. The timeline event is not shown in the recovery panel. Deferral leaves a real committed intent with no staff-facing read. Do not add a latch that only repeats "do not retry" without a GET.

**Portal, same tab.** Keep the existing journal and the idempotent create/finalize replay. An optional later GET by `uploadRequestId` would let resume confirm state before any POST. It is not required to close the staff lost-id case, and it still needs the UUID from `sessionStorage`.

**Portal, journal gone.** No recommended lookup. The server identity is `hash(authUserId, uploadRequestId)`. Without the UUID, a list of recent intents or a checksum search would be a new capability and can attach the wrong additive file. Leave it unrecoverable.

## Non-goals

- No checksum, filename, or "recent intents" search.
- No byte-offset or multipart resume. UC150 already requires the full body and the original file.
- No automatic finalize, storage put, scan, or second intent from the new GET.
- No lifting of the recovery/`uploadRequestId` ban in the recommended slice.
- No cross-tab dedupe. UC150 additive uploads across independent requests stay as they are. This review did not reproduce a duplicate-open defect.
- No change to `readDocumentUploadReceipt`'s response shape. The new lookup's job is to reveal the intent id the receipt GET already accepts, or to say absent/blocked.

## Native boundary

This pass ships the design only. A later GET can be unit-tested with a mocked repository: absent, own unconfirmed, own received, other-actor blocked, expired-created treated as absent, and zero writes. Real Auth/RLS, object storage, scan, and a browser reload of a committed intent stay Native. Historical UC150 SQL evidence does not bind this source. Do not mark Native PASS from this review.
