# T17 WOZTELL provider contract and pilot gate

## Verified contract, 2026-09-27

The existing BotAPI adapter uses `POST https://bot.api.woztell.com/sendResponses`, a Bearer access token, channel ID, recipient ID and a text/template response. WOZTELL documents Bearer as an alternative to the query token, and the `bot:sendResponses` or `bot:admin` scope. A `200` plus `ok: 1` is the documented success shape; the code also requires a concrete provider message ID. No idempotency guarantee for an unknown send result was confirmed, so an unknown result is held for human reconciliation and never auto-retried. Source: https://doc.woztell.com/docs/reference/bot-api-reference/

WOZTELL documents `X-Woztell-Signature` as Base64 HMAC-SHA256 over the raw request body with the channel secret. The existing webhook verifies before writes. `INBOUND` status events carry `SENT`, `DELIVERED` or `READ` and a message ID; the repository deduplicates deliveries and only advances status. An unknown provider message ID remains unmatched. Sources: https://doc.woztell.com/docs/documentations/channels/channels-webhook/ and https://doc.woztell.com/docs/documentations/security/security-overview/

WOZTELL Open API documents `apiViewer.file(fileId)` with `file:get` (or higher) scope, while the older `whatsAppFile` field is deprecated and unsupported. The current code captures attachment references but does not download or serve them; T19 requires tenant-scoped file ID evidence, an approved Open API credential, bounded private download and the existing scan pipeline. This source check does not authorize treating a webhook URL as safe to fetch. Source: https://doc.woztell.com/open-api-reference/

The contract test uses only fixtures and a disposable PostgreSQL database. It does not send a message. Simulated and local delivery have no provider message ID, and local mode never reports live sending even if bindings are present. The configured delivery path and a healthy connection are separate: all four bindings are required for the former; the latter needs a current successful probe tied to this deployment with a real evidence reference. Old, future, or foreign-deployment proof cannot mark healthy. The current server has no approved read-only probe credentials or evidence source, so it reports unverified even when all bindings exist. The inbox never calls an unverified empty list "no conversations".

## Server-only variable map

| Variable | Required source and purpose |
| --- | --- |
| `WOZTELL_API_BASE_URL` | Approved WOZTELL BotAPI base URL, expected `https://bot.api.woztell.com`; no arbitrary endpoint. |
| `WOZTELL_ACCESS_TOKEN` | WOZTELL tenant-issued scoped BotAPI access token authorized for `bot:sendResponses`; keep only in deployment secrets. |
| `WOZTELL_CHANNEL_ID` | The approved WhatsApp channel ID in that tenant; verify against the designated test channel. |
| `WOZTELL_WEBHOOK_SECRET` | The designated channel secret used for raw-body webhook HMAC verification; keep only in deployment secrets. |

Only variable names, missing names and non-secret capability evidence may appear in the UI or logs. Never paste values into tickets, test fixtures or a client bundle.

## Pilot sequence and remaining dependencies

1. Provider owner supplies tenant identity, four binding values in deployment secrets, a scoped read-only probe API/token and a designated non-client test number. Confirm the BotAPI versus Open API token scopes separately; do not assume the send token is a read token.
2. Check the read-only connection endpoint without sending a message. Record checked time, success time, deployment commit and provider evidence reference. The probe must be tied to the current deployment and cannot infer success from binding presence.
3. With separate approval for the exact test recipient and purpose, verify one signed inbound message, one approved outbound send and `SENT`/`DELIVERED`/`READ` receipts. Record provider message ID and ordering. An unknown send result stays held; no automatic retry.
4. Confirm webhook subscription, actual deployment URL, provider permissions and staff inbox display. Keep demo mode read-only and clearly simulated.

No provider credentials, approved test number, live runtime probe or actual inbound/outbound/receipt evidence were available in this local implementation. No live recipient was contacted and no deployment was changed. T17 is local-passing only; its runtime gate remains blocked.

## Local verification

- Named `t17_scenario_1/2/3`: initial RED 1/3 because capability/missing-binding fields did not exist; second RED 1/3 because stale success proof was marked healthy; third RED 1/3 because local mode falsely reported live sending. Focused GREEN 6/6 files, 63/63 tests against disposable PostgreSQL 17, including signed payload, replay ID, unknown receipt, simulated/provider ID separation, capability proof and UI status.
- Final full regression passed 203/203 files and 1824/1824 tests with both local database variables. Typecheck and build passed; lint had 0 errors and one existing Fast Refresh warning. The 13-route verifier passed 13/13 with no import-protection violation using an otherwise identical temporary copy with a 120-second cold-start allowance; the copy was removed. `verify:firm --dry-run` did 38 reads, 0 network calls and 0 writes. `db:inspect` on the disposable database remained current with eight schema capabilities ready and no definition mismatch. No T17 migration is needed.
