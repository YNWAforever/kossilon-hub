# Kossilon Hub

## Production validation

Run the offline production-route and firm-deployment gates before any pilot deployment:

```powershell
npm.cmd run check:production-imports
npm.cmd run verify:firm -- --dry-run
```

The firm verification command reports required binding and provider names only. It does not read secret values, call external services, or provision resources.
## Pre-pilot readiness evidence

The offline verifier is the required first gate:

    npm.cmd run check:production-imports
    npm.cmd run verify:firm -- --dry-run

The current dry run passes local strict-data-mode, route-import-guard, local-provider-mode, migration-schema, Neon Auth capability, and cron checks. It reports database, storage, malware scanner, WhatsApp, email, backups, and browser evidence as blocked until separately approved resources and evidence exist. It performs zero network calls or resource writes and never returns secret values.
