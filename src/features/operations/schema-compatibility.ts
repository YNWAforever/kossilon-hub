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

export type SchemaCapability =
  | "documents"
  | "payments"
  | "parties"
  | "analysis"
  | "maintenance"
  | "packages"
  | "submissions"
  | "returns"
  | "media"
  | "staff"
  | "templates";
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
  { capability: "packages", kind: "table", name: "filing_packages" },
  {
    capability: "packages",
    kind: "column",
    name: "filing_packages.manifest_sha256",
    expected: "text",
  },
  {
    capability: "packages",
    kind: "column",
    name: "filing_packages.artifact_sha256",
    expected: "text",
  },
  {
    capability: "packages",
    kind: "index",
    name: "filing_packages_case_latest_idx",
    expected: "case_id, revision desc",
  },
  {
    capability: "packages",
    kind: "constraint",
    name: "filing_packages_approval_agrees",
    expected: "approved_by is not null",
  },
  { capability: "submissions", kind: "table", name: "package_handoffs" },
  {
    capability: "submissions",
    kind: "column",
    name: "package_handoffs.package_id",
    expected: "uuid",
  },
  {
    capability: "submissions",
    kind: "column",
    name: "package_handoffs.proof_version_id",
    expected: "uuid",
  },
  {
    capability: "submissions",
    kind: "column",
    name: "package_handoffs.submission_mode",
    expected: "text",
  },
  {
    capability: "submissions",
    kind: "index",
    name: "package_handoffs_live_uidx",
    expected: "recorded_submission",
  },
  {
    capability: "submissions",
    kind: "index",
    name: "package_handoffs_manual_package_uidx",
    expected: "package_id",
  },
  {
    capability: "submissions",
    kind: "constraint",
    name: "package_handoffs_manual_evidence",
    expected: "proof_version_id is not null",
  },
  { capability: "returns", kind: "table", name: "handoff_returns" },
  { capability: "returns", kind: "table", name: "filing_return_source_cursors" },
  { capability: "returns", kind: "table", name: "filing_return_source_objects" },
  {
    capability: "returns",
    kind: "column",
    name: "handoff_returns.source_sha256",
    expected: "text",
  },
  { capability: "returns", kind: "column", name: "handoff_returns.match_state", expected: "text" },
  { capability: "returns", kind: "column", name: "handoff_returns.revision", expected: "integer" },
  {
    capability: "returns",
    kind: "index",
    name: "handoff_returns_source_identity_uidx",
    expected: "source_object_id",
  },
  {
    capability: "returns",
    kind: "index",
    name: "handoff_returns_case_open_idx",
    expected: "case_id",
  },
  {
    capability: "returns",
    kind: "constraint",
    name: "handoff_returns_manual_evidence",
    expected: "document_version_id is not null",
  },
  { capability: "media", kind: "table", name: "whatsapp_message_media" },
  {
    capability: "media",
    kind: "column",
    name: "whatsapp_message_media.download_status",
    expected: "text",
  },
  {
    capability: "media",
    kind: "column",
    name: "whatsapp_message_media.download_object_key",
    expected: "text",
  },
  {
    capability: "media",
    kind: "column",
    name: "whatsapp_message_media.download_revision",
    expected: "integer",
  },
  {
    capability: "media",
    kind: "index",
    name: "whatsapp_message_media_position_uidx",
    expected: "message_id",
  },
  {
    capability: "media",
    kind: "index",
    name: "whatsapp_message_media_download_due_idx",
    expected: "download_next_attempt_at",
  },
  {
    capability: "media",
    kind: "constraint",
    name: "maintenance_job_runs_job_kind_check",
    expected: "drainInboundMediaDownloads",
  },
  { capability: "templates", kind: "table", name: "checklist_template_versions" },
  {
    capability: "templates",
    kind: "column",
    name: "checklist_templates.revision",
    expected: "integer",
  },
  {
    capability: "templates",
    kind: "column",
    name: "checklist_templates.published_version_id",
    expected: "uuid",
  },
  {
    capability: "templates",
    kind: "column",
    name: "annual_return_cases.template_version_id",
    expected: "uuid",
  },
  {
    capability: "templates",
    kind: "column",
    name: "annual_return_checklist_items.template_document_id",
    expected: "text",
  },
  {
    capability: "templates",
    kind: "index",
    name: "annual_return_cases_template_version_idx",
    expected: "template_version_id",
  },
  {
    capability: "templates",
    kind: "index",
    name: "annual_return_checklist_template_document_uidx",
    expected: "template_document_id",
  },
  { capability: "staff", kind: "table", name: "staff_provisioning_requests" },
  { capability: "staff", kind: "table", name: "staff_access_events" },
  {
    capability: "staff",
    kind: "column",
    name: "annual_return_cases.assignment_revision",
    expected: "integer",
  },
  {
    capability: "staff",
    kind: "column",
    name: "companies.assignment_revision",
    expected: "integer",
  },
  {
    capability: "staff",
    kind: "column",
    name: "staff_profiles.access_revision",
    expected: "integer",
  },
  {
    capability: "staff",
    kind: "column",
    name: "staff_provisioning_requests.provider_call_started_at",
    expected: "timestamp with time zone",
  },
  {
    capability: "staff",
    kind: "index",
    name: "staff_access_events_target_idx",
    expected: "target_user_id",
  },
  {
    capability: "staff",
    kind: "constraint",
    name: "staff_provisioning_link_pair",
    expected: "provider_auth_user_id is not null",
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
    packages: { ready: true, issues: [] as string[] },
    submissions: { ready: true, issues: [] as string[] },
    returns: { ready: true, issues: [] as string[] },
    media: { ready: true, issues: [] as string[] },
    staff: { ready: true, issues: [] as string[] },
    templates: { ready: true, issues: [] as string[] },
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
