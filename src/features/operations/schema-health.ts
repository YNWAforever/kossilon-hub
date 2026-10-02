/**
 * Whether the database has actually had the migrations this code requires.
 *
 * Pure. Everything here is decided from a list of expected migration ids and
 * whatever `schema_migrations` says; nothing reads a database or a binding.
 *
 * This exists because the repository had no way to notice a gap it already had.
 * Migrations `0023`-`0033` were merged to `main` and applied to nothing but a CI
 * container that is destroyed with the job. `scripts/db-migrate.ts` only ever
 * runs when a person invokes it, no deploy path calls it, and the app never
 * asks. Code requiring `maintenance_runs`, `document_versions`, `case_parties`
 * and five other tables can therefore be serving against a schema that has none
 * of them, and the only symptom is `relation ... does not exist` surfacing
 * wherever a query happens to land -- eleven migrations behind looks exactly
 * like one bad query.
 */

/**
 * The migrations this build expects, in order, by file name.
 *
 * A copy of `db/migrations/`, because the running Worker has no filesystem and
 * cannot read that directory. `schema-health.test.ts` asserts the two agree in
 * BOTH directions, so adding a migration without adding it here fails the suite
 * rather than quietly shrinking what this check covers. Same arrangement as
 * `SCHEDULED_MAINTENANCE_CRON` and its wrangler template.
 */
export const EXPECTED_MIGRATIONS = [
  "0001_annual_return_control_center.sql",
  "0002_harden_annual_return_schema.sql",
  "0003_annual_return_audit_events.sql",
  "0004_retain_annual_return_audit_events.sql",
  "0005_whatsapp_integration_foundation.sql",
  "0006_production_assignment_sla_foundation.sql",
  "0007_whatsapp_inbox_ordering_indexes.sql",
  "0008_client_register.sql",
  "0009_reclaim_stranded_outbox_rows.sql",
  "0010_index_timeline_and_upload_intent_lookups.sql",
  "0011_whatsapp_delivery_receipts.sql",
  "0012_annual_return_reminder_events.sql",
  "0013_checklist_templates.sql",
  "0014_generalize_work_item_case_reference.sql",
  "0015_officers_and_shareholdings.sql",
  "0016_significant_controllers_and_dr.sql",
  "0017_incorporation_intake.sql",
  "0018_recurring_service_subscriptions.sql",
  "0019_corporate_change_requests.sql",
  "0020_corporate_change_work_items.sql",
  "0021_whatsapp_session_window_indexes.sql",
  "0022_notification_outbox_delivery.sql",
  "0023_document_scan_jobs_and_quarantine_retention.sql",
  "0024_link_uploads_to_checklist_items.sql",
  "0025_nar_import_staging.sql",
  "0026_case_parties_and_requirement_instances.sql",
  "0027_document_versions.sql",
  "0028_document_analysis_jobs_and_findings.sql",
  "0029_whatsapp_send_mode.sql",
  "0030_company_data_origin.sql",
  "0031_whatsapp_message_media.sql",
  "0032_package_handoffs_and_returns.sql",
  "0033_maintenance_runs.sql",
  "0034_notification_outbox_dispatch_marker.sql",
  "0067_repair_outbox_dispatch_marker.sql",
  "0068_company_historical_data_origin.sql",
  "0069_restore_maintenance_job_contract.sql",
  "0070_payment_evidence_entries.sql",
  "0071_staff_admin_contract.sql",
  "0072_durable_bulk_assignment.sql",
  "0073_bulk_maintenance_job_kind.sql",
  "0074_reviewed_nar_apply.sql",
  "0075_nar_legacy_year_review.sql",
  "0076_document_scan_review_versions.sql",
  "0077_document_analysis_evidence.sql",
  "0078_whatsapp_manual_intake.sql",
  "0079_bulk_daily_maintenance.sql",
  "0080_manual_handoff_provenance.sql",
] as const;

export type SchemaLedger = {
  /**
   * False when `schema_migrations` does not exist at all.
   *
   * Deliberately not modelled as an empty `applied` list. A database with no
   * ledger has never been touched by `db-migrate.ts` -- or was built by
   * something else entirely, which is worse -- and "we cannot tell" must not
   * arrive here wearing the same clothes as "nothing has been applied".
   */
  present: boolean;
  /** Migration file names the ledger records, in whatever order it returns. */
  applied: readonly string[];
  /** Only actual ledger hash columns; absent historical hashes stay unknown. */
  hashes?: Readonly<Record<string, string | null>>;
};

export type SchemaHealthState =
  | "unavailable"
  /**
   * No `schema_migrations` table. **Not** `behind`, and not `current`.
   *
   * It is what an empty database looks like, and equally what a database
   * someone provisioned by hand from a schema dump looks like. The second may
   * hold every table this code needs and still be unmanageable, so the honest
   * answer is that the migration state is unknown rather than bad.
   */
  | "no-ledger"
  /** Expected migrations the ledger does not record. The repository's own case. */
  | "behind"
  /**
   * The ledger records migrations this build has never heard of.
   *
   * A different emergency from `behind`: the database has been moved forward by
   * a newer deploy and this code is the old one. Rolling a schema back is
   * usually not possible, so this is a deploy-order problem to escalate, not
   * something running the migrator fixes.
   */
  | "ahead"
  /** Both at once, which no ordinary sequence produces. */
  | "diverged"
  | "current";

export type SchemaHealth = {
  state: SchemaHealthState;
  /** Expected but not recorded as applied, in expected order. */
  missing: readonly string[];
  /** Recorded as applied but absent from this build, sorted. */
  ahead: readonly string[];
  /** Null when there is no ledger to count, which is not the same as zero. */
  appliedCount: number | null;
  expectedCount: number;
  /** Said in words. A colour is not a sentence, and this row is what staff read. */
  summary: string;
};

export function schemaHealthOf(input: {
  expected: readonly string[];
  ledger: SchemaLedger;
}): SchemaHealth {
  const expectedCount = input.expected.length;

  if (!input.ledger.present) {
    return {
      state: "no-ledger",
      // Every expected migration is unaccounted for, but none is reported as
      // `missing`: nothing was compared, because there was nothing to compare
      // against. Listing all 33 here would claim a finding this cannot support.
      missing: [],
      ahead: [],
      appliedCount: null,
      expectedCount,
      summary:
        "這個資料庫沒有 schema_migrations 記錄表，因此無法得知它套用過哪些結構變更。" +
        "這不代表結構正常，而是代表沒有任何證據：可能從未執行過遷移，也可能是以其他方式建立的。",
    };
  }

  const applied = new Set(input.ledger.applied);
  const expected = new Set(input.expected);
  const missing = input.expected.filter((id) => !applied.has(id));
  const ahead = [...applied].filter((id) => !expected.has(id)).sort();
  const shared = { missing, ahead, appliedCount: applied.size, expectedCount };

  if (missing.length > 0 && ahead.length > 0) {
    return {
      ...shared,
      state: "diverged",
      summary:
        `資料庫缺少 ${missing.length} 個此版本需要的遷移，同時有 ${ahead.length} 個此版本不認識的遷移。` +
        "這不是單純的落後，請先確認部署順序，不要直接執行遷移。",
    };
  }

  if (missing.length > 0) {
    return {
      ...shared,
      state: "behind",
      summary:
        `資料庫落後 ${missing.length} 個遷移（最早未套用的是 ${missing[0]}）。` +
        "依賴這些資料表的畫面會直接出錯，而不是顯示空白。",
    };
  }

  if (ahead.length > 0) {
    return {
      ...shared,
      state: "ahead",
      summary:
        `資料庫有 ${ahead.length} 個此版本不認識的遷移；可能來自不同部署或歷史命名，單靠記錄不能判斷實體結構。` +
        "請不要執行遷移，先核對部署順序及實體結構。",
    };
  }

  return {
    ...shared,
    state: "current",
    summary: `${expectedCount} 個預期遷移均有紀錄；實體欄位及索引仍須另行核對。`,
  };
}

export type SchemaFact = {
  key: string;
  present: boolean | null;
  expected: string;
  observed: string | null;
  migrationId?: string;
};

export type SchemaAliasEvidence = {
  expectedId: string;
  recordedId: string;
  equivalent: boolean;
  evidence: string;
};

/** Read-only comparison. A physical contract is scoped to the supplied facts. */
export function auditSchemaReadiness(input: {
  expected: readonly string[];
  expectedHashes?: Readonly<Record<string, string>>;
  ledger: SchemaLedger;
  facts: readonly SchemaFact[];
  aliases?: readonly SchemaAliasEvidence[];
}) {
  const ledger = schemaHealthOf(input);
  const expected = new Set(input.expected);
  const recorded = new Set(input.ledger.applied);
  const reconciledAliases = (input.aliases ?? []).filter(
    (alias) =>
      alias.equivalent &&
      alias.evidence.trim() &&
      expected.has(alias.expectedId) &&
      recorded.has(alias.recordedId),
  );
  const aliasIds = new Set(reconciledAliases.map((alias) => alias.recordedId));
  const unknownIds = ledger.ahead.filter((id) => !aliasIds.has(id));
  const physicalState = input.facts.some((fact) => fact.present === false)
    ? ("missing-ddl" as const)
    : input.facts.length === 0 || input.facts.some((fact) => fact.present === null)
      ? ("unknown" as const)
      : ("verified" as const);
  const hashes = input.expected.map((id) => {
    const expectedHash = input.expectedHashes?.[id] ?? null;
    const recordedHash = input.ledger.hashes?.[id] ?? null;
    return {
      id,
      expected: expectedHash,
      recorded: recordedHash,
      state:
        !expectedHash || !recordedHash
          ? ("unknown" as const)
          : expectedHash === recordedHash
            ? ("match" as const)
            : ("mismatch" as const),
    };
  });
  const ledgerDrift =
    ledger.state !== "current" || hashes.some((hash) => hash.state === "mismatch");
  return {
    expectedIds: [...input.expected],
    recordedIds: [...input.ledger.applied],
    ledger,
    hashes,
    facts: [...input.facts],
    physicalState,
    unknownIds,
    reconciledAliases,
    classification:
      physicalState === "unknown"
        ? ("unknown-physical" as const)
        : physicalState === "missing-ddl"
          ? ledgerDrift
            ? ("ledger-and-ddl" as const)
            : ("missing-ddl" as const)
          : ledgerDrift
            ? ("ledger-only" as const)
            : ("verified" as const),
    // Never authorises a production mutation. This is a diagnostic precondition.
    safeToMigrate: !ledgerDrift && physicalState === "verified",
  };
}

/**
 * What to show for "earliest not applied", as a rule rather than as a ternary
 * buried in JSX.
 *
 * It lives here because the first version got it wrong in the screen: it read
 * `missing[0] ?? "—"`, and under `no-ledger` -- where `missing` is empty because
 * nothing was ever compared -- that rendered the same em dash a fully migrated
 * database shows. The one distinction this whole module exists to preserve,
 * thrown away in the last six characters before the pixel.
 */
export function earliestMissingLabel(
  schema: Pick<SchemaHealth, "appliedCount" | "missing">,
): string {
  if (schema.appliedCount === null) return "無法判斷";
  return schema.missing[0] ?? "—";
}
