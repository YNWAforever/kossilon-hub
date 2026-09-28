# T19 inbound WhatsApp media intake

Scope: local implementation on `codex/kossilon-whatsapp-media`, stacked on T18. Covers K18's inbound attachment gap locally. No production database, provider, recipient, or deployment was changed. Live receipt and media lookup remain unverified.

## Intake and safety

The signed inbound webhook stores each provider message/attachment reference once (`provider_message_id` and attachment position); a different file at the same index is refused by a unique index. The real per-job scheduler adds `drainInboundMediaDownloads` **only** when all three T19 bindings are present: `WOZTELL_OPEN_API_TOKEN` with the tenant's read-only `file:get` scope, `WOZTELL_MEDIA_ALLOWED_HOSTS` containing exact approved HTTPS download hosts, and `WOZTELL_MEDIA_FILE_ID_MAPPING_VERIFIED=true` after proving webhook `waMediaId` resolves as Open API `fileId`. The generic WhatsApp send token does not enable this job. Without all three, references remain pending and the worker is not scheduled. An operator must inspect that absence as a blocked capability, not as a successful empty download pass.

The worker resolves only the fixed [WOZTELL Open API endpoint](https://doc.woztell.com/open-api-reference/), then downloads only from an exact configured host with redirects disabled. It enforces a 15-second timeout, 10 MiB cap, metadata size, response MIME, byte signature and SHA-256 readback. Every lease uses a unique opaque private key, so a stale worker cannot overwrite the current attempt's object. Errors persist a code and either retry with bounded backoff, fail, or mark `manual_reupload` for an expired/missing provider URL. No unverified URL is refreshed by guessing. A failed provider link requires a client reupload through the existing document upload flow.

Staff explicitly choose a case and optional requirement from the inbox. The server checks active staff identity, existing case mutation rights, document scope, a unique verified contact phone/company match (digits-only `waId` is compared to the verified E.164 number), optimistic media revision, private byte checksum and the demo read-only rule. The webhook's heuristic case is never an authority. The link transaction reuses `createUploadIntent` and `finalizeUploadIntent`, creating exactly one document/version plus existing scan and analysis jobs. A replay returns the same version; a different case or requirement is refused. A corrected requirement assignment needs a reason and creates an audit timeline event. It is allowed only before document business review.

An inbound attachment stays quarantined after linking. It cannot be previewed or downloaded until a genuine malware scanner verifies those bytes. The receipt can make a checklist item `Received`, never `Verified`; requirement evidence links are created only by the existing human review service after genuine scan. Downloading a package is not a submission.

## Release and rollback preparation

Forward SQL: `db/migrations/0045_whatsapp_media_download.sql`. It adds download status, retries, lease fencing, object metadata, revision and the scheduled job kind. The schema snapshot and compatibility registry include 0045. Inspect the *actual target* database ledger and definitions before any production migration. First run this read-only collision preflight; any returned row requires human reconciliation of signed webhook evidence before 0045 can be applied:

```sql
select message_id, position, count(*) as attachment_rows
from whatsapp_message_media
group by message_id, position
having count(*) > 1;
```
 T00's production binding and legacy `0006_client_register.sql` remain unresolved; this assignment does not authorize a production migration.

Guarded rollback SQL: `docs/runbooks/whatsapp-media-rollback-0045.sql`. It refuses rollback once any attempt, downloaded metadata, document link or scheduled media job record exists. A used deployment needs a forward repair to retain evidence and private objects. Production rollback is not authorized here.

## Runtime proof still required

1. Obtain a scoped read-only WOZTELL tenant token and the provider's written `waMediaId` to `fileId` mapping plus exact approved media hostname. Verify a real signed webhook reference with a non-client authorized test attachment; record API response metadata and download host without copying token or private bytes into logs.
2. Verify private R2 readback, current deployment job execution, a genuine scanner verdict and staff review. Then observe one authorized case link, rejected duplicate/replay and manual reupload state for an expired link. No live client attachment fetch or reupload request was made during local work.
3. Confirm migration ledger, deployment SHA, scheduler owner, per-job status, object retention, and provider/scanner bindings in the intended environment. Pilot acceptance is a separate decision.

Local adapter tests used mocked HTTP/storage; integration tests used only `kossilon_t13_fresh` / `kossilon_rehearsal` disposable Postgres. See `06_EXECUTION_STATUS.csv` for exact test results and commit.
