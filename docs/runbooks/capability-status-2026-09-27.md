# T08 capability status: local implementation and remaining probe gate

The operations page now derives a status for each capability from deployed binding presence and runtime evidence. The former `BLOCKED_INTEGRATIONS` list supplies descriptions and pilot fallbacks, but it no longer dictates the visible live state. The AI analyzer adapter is reported as implemented; no provider is approved or configured by this change.

A capability is never green merely because bindings exist. A healthy scheduled runtime requires a recent successful scheduled run whose recorded deployment commit matches the active deployment and a valid sole scheduler owner. Provider probe evidence can only make a capability green when its timestamp is fresh (15 minutes or less), it identifies the same deployment and a specific evidence reference, and it records success. Foreign, stale or missing evidence stays unverified; a recent failure is degraded. Legacy maintenance rows lacking a deployment reference stay unverified. Only commit-shaped deployment references are recorded. Binding values never enter the status response.

`buildSafeOperationsHealth` catches current-schema read failures at the server boundary and returns a generic error. A behind-schema read logs only a fixed reason and the schema state. The tests inject a token/signed-URL/DB-host shaped error and assert that neither response nor logs include it. Missing schema yields unavailable queue and run data, not a count of zero. Demo remains read-only and does not call this production endpoint.

## Evidence and remaining dependency

Named T08 scenarios were RED before implementation, then passed locally. A disposable PostgreSQL test verifies that the scheduled run records the deployment reference in the existing `maintenance_runs.passes` JSON and that the repository reads it back. No migration was needed for this evidence field.

Provider reachability is still `unknown` in the deployed read path. The pure status contract accepts a controlled, deployment-scoped probe, but there is no provider-specific network probe, durable probe store, or approved scanner/AI endpoint contract in this slice. Creating provider calls from an operations page would be unsafe and would make each read have external effects. T08 remains in progress until a separate controlled runtime probe service and evidence source are implemented and tested; actual production status remains unverified until deployment and provider authorization gates are met.

Read-only activation review: confirm the active deployment SHA, scheduler owner, expected migrations, and `maintenance_runs` records before interpreting green status. Do not paste binding values or full provider errors into a support ticket. No production database, provider, recipient, deployment, invitation or role was changed here.
