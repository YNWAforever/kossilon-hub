import { schemaHealthOf, type SchemaLedger, type SchemaHealthState } from "./schema-health.ts";

export type SchemaCatalog = {
  tables: readonly string[];
  /** Keys are table.column; values are pg_catalog format_type values. */
  columns: Readonly<Record<string, string>>;
  /** Keys are index names; values are pg_get_indexdef results. */
  indexes: Readonly<Record<string, string>>;
  /** Keys are constraint names; values are pg_get_constraintdef results. */
  constraints: Readonly<Record<string, string>>;
};

export type SchemaCapability = "documents" | "payments" | "parties" | "analysis" | "maintenance";
type Requirement = {
  capability: SchemaCapability;
  kind: "table" | "column" | "index" | "constraint";
  name: string;
  expected?: string;
};

/** Query-bearing schema artifacts, rather than an optimistic migration count. */
export const REQUIRED_SCHEMA_ARTIFACTS: readonly Requirement[] = [
  { capability: "documents", kind: "table", name: "documents" },
  { capability: "documents", kind: "table", name: "document_upload_intents" },
  { capability: "documents", kind: "table", name: "document_scan_jobs" },
  { capability: "documents", kind: "table", name: "document_versions" },
  { capability: "documents", kind: "table", name: "document_version_texts" },
  {
    capability: "documents",
    kind: "column",
    name: "document_versions.document_id",
    expected: "uuid",
  },
  {
    capability: "documents",
    kind: "column",
    name: "document_versions.verified_checksum_sha256",
    expected: "text",
  },
  {
    capability: "documents",
    kind: "index",
    name: "document_versions_current_uidx",
    expected: "superseded_by_version_id is null",
  },
  {
    capability: "documents",
    kind: "index",
    name: "document_scan_jobs_claim_idx",
    expected: "document_scan_jobs",
  },
  { capability: "payments", kind: "table", name: "payments" },
  {
    capability: "payments",
    kind: "column",
    name: "payments.payment_proof_document_id",
    expected: "uuid",
  },
  {
    capability: "payments",
    kind: "column",
    name: "payments.paid_at",
    expected: "timestamp with time zone",
  },
  {
    capability: "payments",
    kind: "constraint",
    name: "payments_payment_proof_document_id_fkey",
    expected: "references documents(id)",
  },
  { capability: "parties", kind: "table", name: "case_parties" },
  { capability: "parties", kind: "table", name: "case_requirement_instances" },
  { capability: "parties", kind: "table", name: "requirement_evidence_links" },
  { capability: "parties", kind: "column", name: "case_parties.case_id", expected: "uuid" },
  {
    capability: "parties",
    kind: "index",
    name: "case_parties_case_idx",
    expected: "case_id, active",
  },
  {
    capability: "parties",
    kind: "index",
    name: "case_requirement_instances_company_uidx",
    expected: "party_id is null",
  },
  { capability: "analysis", kind: "table", name: "document_analysis_jobs" },
  { capability: "analysis", kind: "table", name: "document_findings" },
  {
    capability: "analysis",
    kind: "column",
    name: "document_analysis_jobs.document_version_id",
    expected: "uuid",
  },
  {
    capability: "analysis",
    kind: "index",
    name: "document_analysis_jobs_claim_idx",
    expected: "document_analysis_jobs",
  },
  { capability: "maintenance", kind: "table", name: "maintenance_runs" },
  {
    capability: "maintenance",
    kind: "column",
    name: "maintenance_runs.trigger_source",
    expected: "text",
  },
  {
    capability: "maintenance",
    kind: "index",
    name: "maintenance_runs_recent_idx",
    expected: "scheduled_for desc",
  },
  {
    capability: "maintenance",
    kind: "constraint",
    name: "maintenance_runs_outcome_agrees",
    expected: "outcome",
  },
] as const;

export type DefinitionMismatch = {
  artifact: string;
  expected: string;
  actual: string | null;
};

export type SchemaCompatibilityReport = {
  ledgerState: SchemaHealthState;
  missing: readonly string[];
  unknown: readonly string[];
  definitionMismatch: readonly DefinitionMismatch[];
  requiredCapabilities: Record<SchemaCapability, { ready: boolean; issues: readonly string[] }>;
  canRelease: boolean;
  /** Informational only; never authorizes a database write. */
  canMigrateAutomatically: boolean;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replaceAll('"', "").trim();
}

export function inspectSchemaCompatibility(input: {
  expected: readonly string[];
  ledger: SchemaLedger;
  catalog: SchemaCatalog;
}): SchemaCompatibilityReport {
  const health = schemaHealthOf({ expected: input.expected, ledger: input.ledger });
  const requiredCapabilities = {
    documents: { ready: true, issues: [] as string[] },
    payments: { ready: true, issues: [] as string[] },
    parties: { ready: true, issues: [] as string[] },
    analysis: { ready: true, issues: [] as string[] },
    maintenance: { ready: true, issues: [] as string[] },
  };
  const definitionMismatch: DefinitionMismatch[] = [];
  const tables = new Set(input.catalog.tables.map(normalize));

  for (const requirement of REQUIRED_SCHEMA_ARTIFACTS) {
    const artifact = `${requirement.kind}:${requirement.name}`;
    const actual =
      requirement.kind === "table"
        ? tables.has(normalize(requirement.name))
          ? requirement.name
          : undefined
        : requirement.kind === "index"
          ? input.catalog.indexes[requirement.name]
          : requirement.kind === "column"
            ? input.catalog.columns[requirement.name]
            : input.catalog.constraints[requirement.name];
    const expected = requirement.expected ?? "present";
    if (
      actual !== undefined &&
      (!requirement.expected || normalize(actual).includes(normalize(requirement.expected)))
    ) {
      continue;
    }
    definitionMismatch.push({ artifact, expected, actual: actual ?? null });
    requiredCapabilities[requirement.capability].issues.push(artifact);
    requiredCapabilities[requirement.capability].ready = false;
  }

  const unknown = health.ahead;
  return {
    ledgerState: health.state,
    missing: health.missing,
    unknown,
    definitionMismatch,
    requiredCapabilities,
    canRelease: health.state === "current" && definitionMismatch.length === 0,
    canMigrateAutomatically:
      input.ledger.present && unknown.length === 0 && definitionMismatch.length === 0,
  };
}
