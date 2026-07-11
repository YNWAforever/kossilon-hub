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
  });

  it("retains history and indexes queue, escalation, outbox, membership, and cleanup scans", () => {
    expect(migrationSql).toContain("on delete restrict");
    expect(migrationSql).toContain("on delete set null");

    expect(migrationSql).toContain("invited_by uuid references users(id) on delete restrict");
    expect(migrationSql).toContain("document_id uuid references documents(id) on delete restrict");

    for (const indexName of [
      "work_items_open_queue_idx",
      "work_items_owner_team_idx",
      "work_items_sla_threshold_idx",
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
  });
});
