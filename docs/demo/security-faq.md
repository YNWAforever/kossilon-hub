# Security & FAQ one-pager

Internal source of truth for answering prospect questions. Share the customer-safe sections; keep **internal notes** out
of customer emails.

## Customer-safe summary

ComSec OS is a company-secretary operations workspace for Hong Kong firms. It brings annual returns, document chasing,
payments and client collaboration into one case record with clear ownership.

- **Hosting:** application on Vercel; PostgreSQL and authentication on Neon. The current Neon project runs in the
  Asia-Pacific (`ap-southeast-1`) region; confirm residency requirements and the Vercel region for the pilot contract.
- **Access:** invite-only. Public self-service sign-up is disabled. Supported sign-in methods are password, email login
  link (magic link) and Google, depending on deployment configuration.
- **Roles:** Admin, Manager and Staff on the firm side; Client portal access is scoped per company membership. Authorisation
  is enforced server-side, not only by hiding UI.
- **Demo data:** the public demo uses fictional fixtures (`@kossilon.test`). No real client data is stored in the demo,
  and demo actions are read-only.
- **Transport:** HTTPS with HSTS; strict content-security policy enforced, frame embedding denied, MIME sniffing blocked,
  strict referrer policy and restricted browser permissions.
- **Quality:** CI runs unit, database and browser journeys on every change; accessibility (WCAG A/AA) and dependency
  audits are part of the pipeline; production deploys are followed by an automated smoke test.
- **Recovery:** a restore-branch drill from production data has been executed and passed; database backups/restore
  procedures exist. Object-storage restore is documented but not yet exercised end-to-end.

## FAQ

**Is this a live product or a mock-up?**
Both production and demo deployments are live. The demo is a read-only fixture environment built for evaluation; the
production workspace is invite-only and has real data paths.

**Can we use our own client data in the demo?**
No. The demo is intentionally read-only and must not receive real client data. Real data belongs in a pilot workspace.

**Where is data stored?**
PostgreSQL and authentication are on Neon; the application is on Vercel. The current Neon region is Asia-Pacific
(`ap-southeast-1`). Residency, retention and data-processing terms are confirmed per pilot.

**What happens to our data if we stop?**
Export/exit terms are a pilot-contract topic; the product does not currently offer a public self-service export button.

**Are you ISO 27001 / PDPO certified?**
No certification or formal compliance attestation is claimed here. We can describe the controls above and complete a
security questionnaire as part of a pilot. Ask legal/owner before making any certification statement.

**Which integrations are live?**
The core workspace (cases, documents metadata, reminders, payments, roles, client visibility, operations/health) is live.
Outbound email, WhatsApp/WOZTELL, document scanning and object-storage upload are configuration-dependent and are shown
honestly as unconfigured until provider credentials are supplied.

**Is WhatsApp part of the product?**
The chase/inbox experience is designed; sending requires a configured WOZTELL channel and approved templates. It is not
claimed as live for the demo.

**How long does onboarding take?**
A pilot starts with a small team and a defined case set; the exact onboarding scope (data import, roles, templates) is
agreed before the pilot. Do not promise instant self-serve onboarding.

**Who can see a client’s case?**
Firm staff see cases within their authorised scope; a client sees only their own company’s portal. Access is enforced on
the server for every read/write.

**What does “read-only demo” mean?**
Navigation, filters and views work; creating, uploading, approving, sending and completing are disabled. This protects the
demo environment and sets honest expectations for the pilot.

## Internal notes — do not send to prospects

- Public sign-up is blocked at the auth proxy (`SIGNUP_DISABLED`), and the post-deploy smoke checks it.
- `email=false` in `/api/capabilities` means the transactional outbox (Resend) is unprovisioned; login emails come from
  Neon Auth, so this is not a login outage.
- R2 pairing drill exists but has not run against production (credentials absent); full R2 restore is owner-run.
- Authenticated UAT with real invited accounts is still unproven; phrase production readiness cautiously.
- Do not disclose internal hostnames, credentials, branch names, or the local Neon key.
