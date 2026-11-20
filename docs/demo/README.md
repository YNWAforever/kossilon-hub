# ComSec OS — customer demo kit (Phase A)

Internal enablement pack for showing ComSec OS to potential customers. The demo is a **read-only fixture build**
(ADR-0001); it never contains real client data and every action that would write is intentionally unavailable.

## Links

| Purpose                       | Link                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Demo entry                    | [Chinese](https://kossilon-hub-demo.vercel.app/) · [English](https://kossilon-hub-demo.vercel.app/en)                    |
| Persona picker                | [Chinese](https://kossilon-hub-demo.vercel.app/login) · [English](https://kossilon-hub-demo.vercel.app/en/login)         |
| Request a pilot conversation  | [Chinese](https://kossilon-hub.vercel.app/request-access) · [English](https://kossilon-hub.vercel.app/en/request-access) |
| Guided script                 | [guided-script-15min.md](guided-script-15min.md)                                                                         |
| Security & FAQ one-pager      | [security-faq.md](security-faq.md)                                                                                       |
| Feedback form + outreach copy | [feedback-and-outreach.md](feedback-and-outreach.md)                                                                     |

Do **not** share production `/demo` (it is the “demo is not enabled here” page) or the production workspace.

## Demo identities (one click, no credentials)

| Persona      | Role    | Use it to show                                                             |
| ------------ | ------- | -------------------------------------------------------------------------- |
| **Amy Chan** | Admin   | Presenter route through the dashboard, Crestview filing and client preview |
| **Ken Wong** | Manager | Manager navigation and the read-only annual-return fixture                 |
| **Mei Lam**  | Staff   | Staff navigation and the read-only annual-return fixture                   |

Fixtures use `@kossilon.test` addresses. Reloading resets everything; there is nothing to clean up afterwards.

## Before every demo (5 minutes)

1. Run `npm run demo:preflight` to check both locale links, the persona pickers, production intake forms, deployment revisions and production CSP. Investigate any failed HTTP check.
2. In a fresh browser session, follow **Try the demo** or **試用示範** from the homepage. Select Amy and confirm the **示範模式** banner and dashboard appear.
3. Open **周年申報**, search for **Crestview** and open that filing. Open **客戶入口** and confirm it shows the same company. Sign out after rehearsing.
4. Open the demo page’s request-access link and confirm it leads to the production form in the selected language. Have that link and the feedback destination ready for the call.
5. Set the expectation “It’s a read-only demo with fictional data. The production pilot is invite-only.”

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
