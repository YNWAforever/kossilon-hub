# Kossilon Hub

## Production validation

Run the offline production-route and firm-deployment gates before any pilot deployment:

```powershell
npm.cmd run check:production-imports
npm.cmd run verify:firm -- --dry-run
```

The firm verification command reports required binding and provider names only. It does not read secret values, call external services, or provision resources.
