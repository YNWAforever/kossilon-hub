# R16 Clients coordination request for Dirac

User assigned this worker the Clients URL context and authorized coordination with Dirac, who owns `production-client-detail.tsx` UI. This session has no exposed subagent messaging tool or Dirac thread target; this is a local coordination request, not a claim of delivery.

Please add `returnTo?: string` to `ProductionClientDetail` (default `/clients`) and pass it to `ClientDetail` and `ClientNotFound`. Use the existing `caseReturnPath` sanitizer for the rendered back links (parent has allowed `/clients`), with `/clients` fallback. Keep detail UI otherwise under Dirac's ownership.

This worker is implementing validated `q/status/team/includeFixtures/cursor` URL state and list detail links with `search={{ returnTo: clientRegisterReturnPath(search) }}`. The only intended change to `clients.$id.tsx` is validating a scalar safe `returnTo` and passing that string to `ProductionClientDetail` once the prop is available. No SQL read changes. Invalid or repeated list-filter values must reject the read, not widen to all clients.

Update: list URL state, validation, and safe route passthrough are implemented. `clients.$id.tsx` now forwards `{ clientId, actorScope, returnTo }` as props without editing the detail UI. The 57 local tests pass at this boundary. The actual detail component still needs to consume `returnTo` for its visible back links; see `R16-clients.md` for exact verified limits.
