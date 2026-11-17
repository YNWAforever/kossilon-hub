# ComSec OS — customer demo kit (Phase A)

Internal enablement pack for showing ComSec OS to potential customers. The demo is a **read-only fixture build**
(ADR-0001); it never contains real client data and every action that would write is intentionally unavailable.

## Links

| Purpose                       | Link                                                 |
| ----------------------------- | ---------------------------------------------------- |
| Demo entry (self-serve)       | https://kossilon-hub-demo.vercel.app/                |
| Direct persona login          | https://kossilon-hub-demo.vercel.app/login           |
| Book a pilot / request access | https://kossilon-hub.vercel.app/request-access       |
| Guided script                 | [guided-script-15min.md](guided-script-15min.md)     |
| Security & FAQ one-pager      | [security-faq.md](security-faq.md)                   |
| Feedback form + outreach copy | [feedback-and-outreach.md](feedback-and-outreach.md) |

Do **not** share production `/demo` (it is the “demo is not enabled here” page) or the production workspace.

## Demo identities (one click, no credentials)

| Persona      | Role    | Use it to show                                                                            |
| ------------ | ------- | ----------------------------------------------------------------------------------------- |
| **Amy Chan** | Admin   | Full workspace: today, queue, annual returns, documents, payments, operations, user admin |
| **Ken Wong** | Manager | Team view and the same operational screens with manager scope                             |
| **Mei Lam**  | Staff   | Day-to-day assigned work and least-privilege view                                         |

Fixtures use `@kossilon.test` addresses. Reloading resets everything; there is nothing to clean up afterwards.

## Before every demo (5 minutes)

1. Run `npm run demo:preflight` — it checks the demo personas, demo/marketing freshness, booking form, invite-only signup
   and enforced CSP without using credentials. It must end with **READY**.
2. Open the demo in a fresh Chrome window at 100% zoom; close notifications and personal tabs.
3. Confirm the **示範模式** banner is visible and the three personas are listed on `/login`.
4. Click each persona once to confirm it reaches `/dashboard`; then sign out.
5. Check network is stable; if the demo deployment is stale, tell the owner instead of demoing an old build.
6. Have the booking link and feedback form ready in the chat/email draft.
7. Set the expectation in one sentence: “It’s a read-only demo with fictional data; the production pilot is invite-only.”

## Guardrails

- Never enter a prospect’s real company names, client data, emails or documents anywhere in the demo.
- Say “read-only” before a write action so inert controls do not look broken.
- Label unprovisioned integrations as roadmap: WhatsApp, outbound email, document scanner, R2 upload/scan.
- Do not claim certifications, PDPO compliance, live WhatsApp/email, or a completed production UAT.
- Pricing is not published; answer with the pilot discussion, not an invented price.

## Owner actions still needed (agent cannot provision these)

1. **Branded URL (optional):** in Vercel project `kossilon-hub-demo` → Settings → Domains, add the chosen hostname
   (for example `demo.<your-domain>`); point DNS CNAME to `cname.vercel-dns.com`. Keep the `vercel.app` URL as fallback.
2. **Feedback destination:** create a Google Form/Tally using the questions in
   [feedback-and-outreach.md](feedback-and-outreach.md), or name an inbox; then add the link to follow-up templates.
3. **Booking ownership:** decide who answers `/request-access` requests and the promised response time.
