import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schemaSql = readFileSync(
  resolve(process.cwd(), "src/server/db/schema.sql"),
  "utf8",
).toLowerCase();
const migrationPath = resolve(
  process.cwd(),
  "db/migrations/0006_production_assignment_sla_foundation.sql",
);
const migrationSql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const seedSource = readFileSync(resolve(process.cwd(), "scripts/db-seed-annual-return.ts"), "utf8");
const compactMigrationSql = migrationSql.replace(/\s+/g, " ");

const requiredTables = [
  "staff_profiles",
  "staff_skills",
  "client_company_memberships",
  "business_calendars",
  "business_calendar_holidays",
  "sla_policies",
  "work_items",
  "assignment_events",
  "escalation_events",
  "notification_outbox",
  "document_upload_intents",
] as const;

describe("production workflow schema", () => {
  it("defines every production workflow table in the migration and canonical schema", () => {
    for (const table of requiredTables) {
      expect(migrationSql).toContain(`create table ${table}`);
      expect(schemaSql).toContain(`create table if not exists ${table}`);
    }
  });

  it("links Neon Auth identities without cross-schema foreign keys", () => {
    expect(migrationSql).toContain("auth_user_id text not null");
    expect(migrationSql).not.toMatch(
      /foreign key\s*\(auth_user_id\)|auth_user_id\s+text\s+references/,
    );
    expect(migrationSql).toContain(
      "role text not null check (role in ('admin', 'manager', 'staff', 'client'))",
    );
  });

  it("stores immutable SLA snapshots and optimistic work-item versions", () => {
    expect(migrationSql).toContain("version integer not null default 1");
    expect(migrationSql).toContain("sla_policy_version_id uuid not null");
    expect(migrationSql).toContain("sla_warning_at timestamptz not null");
    expect(migrationSql).toContain("sla_due_at timestamptz not null");
    expect(migrationSql).toContain("sla_breached_at timestamptz");
    expect(migrationSql).toContain("unique (work_item_id, sla_policy_version_id, threshold)");
    expect(migrationSql).toContain("enforce_work_item_sla_snapshot_immutability");
    expect(migrationSql).toContain("enforce_sla_policy_version_immutability");
    expect(migrationSql).toContain("enforce_business_calendar_version_immutability");
  });

  it("constrains lifecycle, recommendation audit, and privacy retention", () => {
    for (const value of [
      "required_skill_key text",
      "escalation_state text",
      "escalation_targets jsonb not null",
      "priority_modifier integer not null",
      "decision text not null",
      "recommendation_factors jsonb not null",
      "retention_until timestamptz not null",
      "redacted_at timestamptz",
    ]) {
      expect(migrationSql).toContain(value);
    }
    expect(migrationSql).toContain("assignment_events_override_reason_check");
    expect(migrationSql).toContain("assignment_events_recommendation_evidence_check");
    expect(compactMigrationSql).toContain(
      "jsonb_typeof(recommendation_factors) = 'object' and recommendation_factors <> '{}'::jsonb",
    );
    expect(migrationSql).toContain("notification_outbox_redaction_check");
    expect(migrationSql).toContain("old.business_calendar_id");
    expect(migrationSql).toContain("new.business_calendar_id");
    for (const invariant of [
      "sla_started_at <= sla_warning_at",
      "sla_warning_at < sla_due_at",
      "attempt_count <= max_attempts",
      "acknowledged_at is null and acknowledged_by_id is null",
      "checksum_sha256 ~ '^[0-9a-f]{64}$'",
    ]) {
      expect(compactMigrationSql).toContain(invariant);
    }
  });

  it("defines queue and maintenance indexes in query order", () => {
    for (const definition of [
      "work_items_open_queue_idx on work_items ((sla_breached_at is null), sla_due_at, priority desc, id)",
      "work_items_owner_idx on work_items (owner_id, (sla_breached_at is null), sla_due_at, priority desc, id)",
      "work_items_team_idx on work_items (team_id, (sla_breached_at is null), sla_due_at, priority desc, id)",
      "work_items_sla_warning_idx on work_items (sla_warning_at, id)",
      "work_items_sla_due_idx on work_items (sla_due_at, id)",
      "notification_outbox_retry_idx on notification_outbox (next_attempt_at, created_at)",
      "notification_outbox_retention_idx on notification_outbox (retention_until)",
      "document_upload_intents_cleanup_idx on document_upload_intents (expires_at)",
    ]) {
      expect(compactMigrationSql).toContain(definition);
    }
  });

  it("retains history and indexes queue, escalation, outbox, membership, and cleanup scans", () => {
    expect(migrationSql).toContain("on delete restrict");
    expect(migrationSql).toContain("on delete set null");

    expect(migrationSql).toContain("invited_by uuid references users(id) on delete restrict");
    expect(migrationSql).toContain("document_id uuid references documents(id) on delete restrict");

    for (const indexName of [
      "work_items_open_queue_idx",
      "work_items_owner_idx",
      "work_items_team_idx",
      "work_items_sla_warning_idx",
      "work_items_sla_due_idx",
      "notification_outbox_retry_idx",
      "client_company_memberships_lookup_idx",
      "document_upload_intents_cleanup_idx",
    ]) {
      expect(migrationSql).toContain(`create index ${indexName}`);
    }
  });

  it("seeds deterministic identities, access, policy, capacity, skills, and work", () => {
    for (const value of [
      "Amy Chan",
      "Ken Wong",
      "Mei Lam",
      "client.harbour@example.test",
      "staff_profiles",
      "staff_skills",
      "client_company_memberships",
      "business_calendars",
      "sla_policies",
      "work_items",
    ]) {
      expect(seedSource).toContain(value);
    }

    for (const adoptionMap of [
      "staffProfileIdsByFixtureId",
      "businessCalendarIdsByFixtureId",
      "slaPolicyIdsByFixtureId",
    ]) {
      expect(seedSource).toContain(adoptionMap);
    }
    expect(seedSource).toContain("returning user_id, id");
    expect(seedSource).toContain("returning policy_key, version, id");
    expect(seedSource).toContain("assertCalendarFixtureMatches");
    expect(seedSource).toContain("assertSlaPolicyFixtureMatches");
    expect(seedSource).toContain(
      "on conflict (policy_key, version) do update set policy_key = excluded.policy_key",
    );
  });

  it("keeps durable annual-return case notes with author and chronological lookup", () => {
    expect(schemaSql).toContain("create table if not exists case_notes");
    expect(schemaSql).toContain("author_id uuid not null references users(id)");
    expect(schemaSql).toContain("case_notes_case_idx on case_notes (case_id)");
  });
});
