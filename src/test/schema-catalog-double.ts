import { EXPECTED_MIGRATIONS, type SchemaLedger } from "@/features/operations/schema-health";
import type { SqlClient } from "@/server/db/client";
import type { AuthRole } from "@/features/auth/types";

/** Unit-only SQL transport; every unexpected query (especially writes) fails. */
export function schemaCatalogDouble(role: AuthRole = "Staff") {
  const state = {
    ledger: { present: true, applied: [...EXPECTED_MIGRATIONS] } as SchemaLedger,
    marker: true,
    index: true,
    active: true,
    provisioned: true,
    readFailure: false,
    queries: [] as string[],
  };
  const sql = (async (parts: TemplateStringsArray) => {
    const text = parts.join("?");
    state.queries.push(text);
    if (text.includes("staff_profiles"))
      return role === "Client" || !state.provisioned
        ? []
        : [
            {
              user_id: "ac7d801e-0189-4189-8189-000000000001",
              role,
              team_id: "ac7d801e-0189-4189-8189-000000000002",
              active: state.active,
            },
          ];
    if (text.includes("client_company_memberships"))
      return state.provisioned && state.active
        ? [{ company_id: "ac7d801e-0189-4189-8189-000000000003", active: true }]
        : [];
    if (state.readFailure) throw new Error("private database path and credential must not escape");
    if (text.includes("to_regclass('schema_migrations')") && text.includes("application"))
      return [{ ledger: state.ledger.present, application: true }];
    if (text.includes("attname = 'sha256'")) return [{ present: false }];
    if (text.includes("select id from schema_migrations"))
      return state.ledger.applied.map((id) => ({ id }));
    if (text.includes("format_type"))
      return state.marker ? [{ type: "integer", not_null: false, default_expression: null }] : [];
    if (text.includes("pg_index"))
      return state.index
        ? [
            {
              valid: true,
              definition: "synthetic verified index",
              key_column: "updated_at",
              predicate:
                "((status = 'processing'::text) AND (dispatch_started_attempt IS NOT NULL))",
            },
          ]
        : [];
    throw new Error("Unexpected SQL in unit admission double");
  }) as unknown as SqlClient;
  return { state, sql };
}
