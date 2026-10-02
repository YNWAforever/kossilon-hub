# T17 WhatsApp receipt and attachment runbook

## Candidate and release gate

F11 uses the existing WOZTELL webhook, outbox leases/fencing/0034 dispatch marker,
case policy and document upload/scan/version services. Local tests are synthetic
provider contracts and actual isolated Postgres. They do not establish provider
health, fresh NeonAuth sessions, real scan safety or actual client delivery.
No production migration, deployment, recipient send or invitation is authorized
for this candidate. 0078 is additive and local only. Release must reconcile the
46 source migration IDs with the last observed production 66 historical IDs;
do not replay an old ledger or renumber migrations.

## Bindings and owners

| Dependency          | Server binding or evidence                                                 | Owner / next step                                                                                                           |
| ------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| BotAPI              | `WOZTELL_API_BASE_URL=https://bot.api.woztell.com`                         | Messaging owner confirms tenant and official endpoint.                                                                      |
| Access              | `WOZTELL_ACCESS_TOKEN`                                                     | Messaging owner supplies scoped token (`bot:sendResponses`, `file:get`); keep secret server-side.                           |
| Channel             | `WOZTELL_CHANNEL_ID`                                                       | Messaging owner confirms the approved WhatsApp channel.                                                                     |
| Signature           | `WOZTELL_WEBHOOK_SECRET`                                                   | Messaging owner supplies raw-body HMAC secret; security owner validates signed inbound/status samples.                      |
| Media host policy   | `WOZTELL_MEDIA_ALLOWED_HOSTS` (comma-separated exact approved HTTPS hosts) | Security/storage owner supplies observed provider CDN hosts. Empty policy blocks downloading; no wildcard or private hosts. |
| R2/scanner          | Existing document bindings, genuine provider verdict and version/hash      | Storage/scanner owners verify actual bytes, malware/fault specimens and retained quarantine.                                |
| Identity            | Fresh verified staff/profile and scoped case                               | Auth owner verifies fresh Admin/Staff sessions and revocation. Mapping is Admin-only; no new role/grant.                    |
| Delivery acceptance | Controlled recipient, approved template and human approval                 | Messaging/release owners obtain explicit one-recipient send authority after preview and test package review.                |
| Scheduled runtime   | Existing maintenance owner, genuine scheduled run IDs                      | Operations owner verifies three real ticks; mock transport/manual tick is not runtime acceptance.                           |

The status RPC returns binding presence and `verificationStatus=not_verified`;
it never returns secrets. All four keys were absent in the **2026-10-01 Vercel
read-only observation**, Cloudflare topology unknown. This is not a fresh check.
Do not infer connection health from historical conversations or a configured token.

## Protocol evidence

- [WOZTELL BotAPI](https://doc.woztell.com/docs/reference/bot-api-reference/):
  `POST /sendResponses`, Bearer authentication, channel/recipient/response.
  A provider message ID establishes acceptance; DELIVERED/READ receipt establishes delivery.
- [MessageEvent](https://doc.woztell.com/docs/reference/message-event-reference/):
  current media uses top-level `data.fileId`. Preserve legacy `waMediaId`; do not
  guess its conversion or call the deprecated `whatsAppFile` operation.
- [OpenAPI reference](https://doc.woztell.com/open-api-reference/):
  `https://open.api.woztell.com/v3`, `apiViewer.file(fileId: ID)` returns file ID,
  URL and declared size. The adapter checks the returned identity before fetching.
- [Access token scopes](https://doc.woztell.com/docs/documentations/settings/access-token/)
  and [signed webhooks](https://support.woztell.com/portal/en/kb/articles/web).

These read-only documentation checks are not actual tenant protocol acceptance.
Media fetch refuses unapproved hosts/credentials/ports/private DNS answers and
rechecks every redirect (maximum three), limits 10 MiB and 15 seconds across the
operation, checks MIME/signature/declared size, hashes bytes and cancels aborting
streams. CDN GET never receives the access token. Standard fetch does not pin DNS:
approved owned CDN DNS/TLS is an explicit trust boundary. If that boundary cannot
be guaranteed, keep intake blocked and obtain a pinned transport from the runtime
owner; do not broaden the host policy.

## Operational flow

1. Open an inbound message's mapping/attachment review. Shared phone history for
   more than one client company stays unmapped. Admin selects the confirmed client
   case/year, supplies a reason and approves the observed mapping revision.
   Only that message changes; contact-wide guessing is prohibited. Same approval
   replays once; stale/different approval is HTTP409. Closed/locked/nonclient cases
   and current profile revocation are refused server-side.
2. Select attachment category and, where known, its matching checklist item.
   Unbound evidence needs internal review/requirement mapping; do not infer its
   purpose from an image caption or automatically satisfy unrelated requirements.
   The documented file adapter downloads bounded untrusted bytes outside the DB
   transaction; publication rechecks locked actor/case/message/media revision.
3. Existing single-upload service creates a 15-minute intent, opaque R2 key,
   document version, quarantine, scan/analysis jobs and linked checklist receipt.
   It never invokes a deterministic scanner or grants download safety. Review is
   pending and verified hash remains NULL. Same media resumes its same intent
   only for identical file identity/hash/MIME/size/category/requirement; receipt
   replay preserves the original intent/version even after later replacement.
4. Once an intent exists, mapping cannot move. Expired/changed intent needs a
   reviewed recovery decision; no automatic new intent or deletion of uncertain
   objects. R2 put uses the existing finalization transaction; an interrupted put
   can leave an orphan object with no committed receipt. Retain intent/key evidence
   and use the document recovery runbook; do not mark available or delete blindly.
5. Linked Missing/Rejected checklist evidence becomes Received through the same
   upload domain service. Received is internal scan/review work and is not a missing
   document chase. Returned payment proofs use the existing attributed business
   return predicate tied to the exact current version, not fictitious receipt data.
6. Outbound follow-up shows full recipient/message before approval. Queue accepts
   only the observed canonical version of the case/evidence/recipient. Recipient or
   version changes require fresh preview; identity is request-derived and the queue
   locks current users/profile and case policy again. Outside the session window,
   the approved template may differ from the displayed free-text draft: verify its
   approved content with the messaging owner before controlled live acceptance.
7. UI separates draft/queued/provider_accepted/delivered/failed/unknown. Unknown
   acknowledgement, accepted-without-ID and active dispatch marker require provider
   reconciliation. They do not retry. Signed early receipts and ID linkage share an
   advisory lock and the same monotonic receipt service; raw audit is retained and
   duplicate or unsigned receipts cannot fabricate delivery.

## Unknown outcome reconciliation

2026-10-02 metadata-only `vercel env ls production` on the named project/team
confirms all four WOZTELL bindings and `WOZTELL_MEDIA_ALLOWED_HOSTS` are absent.
R2/Auth/DB bindings are present; no secret values or genuine provider roundtrip
were read/tested. Messaging owner supplies approved tenant/channel/protocol and
scoped credentials; Security owner approves exact CDN hosts/DNS trust; Storage/
scanner/Auth owners supply controlled staging samples and fresh-role acceptance.

Signed status ingestion enters the repository's atomic source-validation operation
before updating any message. Conflicting same-event payloads retain the original
source plus a separate failed audit and leave both messages' status/timestamps
unchanged. The HTTP acknowledgement only confirms that raw evidence was retained;
it does not certify delivery. Duplicate and early-binding receipts reuse the same
monotonic domain service, without an additional pre-validation status write.

Pause the affected item. Record outbox/message IDs, attempt/dispatch marker and
tenant/channel/request time; obtain provider evidence by the approved operator
interface. Never paste access tokens in tickets or logs. Confirm whether one
message exists and its actual provider ID/status. Prepare a guarded correction
with expected item version/attempt, operator identity, provider evidence and
rollback before seeking any required production SQL authority. If the provider
cannot establish the outcome, retain unknown and do not automatically resend.
Live reconciliation/provider query API is not invented in this candidate.

## Migration and rollback

0078 adds mapping revision, explicit media ID kind, nullable original intake intent
FK and a partial index for unmatched signed receipts. Existing references remain
legacy; no receipt, scan, file bytes or mapping decision is backfilled. Local
rehearsal repeats the additive SQL on a populated minimal schema, rejects invalid
CHECK values and rolls back the new fields while preserving original references.

For approved release: read-only compare ledger/hashes/physical DDL and deployment
order, create a provider recovery point, rehearse the exact SQL on a staging branch,
review counts and run the candidate tests, then obtain the final operation approval.
Abort on lineage mismatch. Code rollback retains additive columns/history, pauses
the affected operations/scheduler and returns the approved prior build. Do not drop
intake references or restore/reset production data as a routine rollback.
