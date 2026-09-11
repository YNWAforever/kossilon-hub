import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  earliestMissingLabel,
  EXPECTED_MIGRATIONS,
  schemaHealthOf,
  type SchemaLedger,
} from "./schema-health";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

function migrationFilesOnDisk(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function ledger(applied: readonly string[]): SchemaLedger {
  return { present: true, applied };
}

describe("EXPECTED_MIGRATIONS tracks db/migrations", () => {
  /**
   * A traversal that found nothing would make every assertion below vacuous,
   * which is how this kind of check rots into a test that cannot fail.
   */
  it("finds the migrations it is meant to police", () => {
    expect(migrationFilesOnDisk().length).toBeGreaterThan(30);
  });

  /**
   * Both directions, and in order.
   *
   * A file on disk missing from the constant shrinks what the drift check covers
   * -- silently, and in the direction that matters, because the newest migration
   * is exactly the one a database is most likely not to have. A name in the
   * constant with no file makes the check report a permanent false `behind`
   * nobody can clear.
   */
  it("matches the directory exactly, in order", () => {
    // Compared against a SORTED listing, which pins the order as well as the
    // contents: db-migrate.ts does readdir().filter(.sql).sort() and applies in
    // that order, so a constant ordered any other way would name the wrong
    // migration as "the earliest one missing". A separate "is it sorted" test
    // would add nothing -- this assertion already fails if it is not.
    expect([...EXPECTED_MIGRATIONS]).toEqual(migrationFilesOnDisk());
  });
});

describe("schemaHealthOf", () => {
  /**
   * The state that must never be mistaken for health.
   *
   * An empty database and a database somebody built by hand from a schema dump
   * are indistinguishable from here. The second may hold every table this code
   * needs, so the honest answer is that nothing is known -- not that everything
   * is missing, and certainly not that everything is fine.
   */
  it("treats a missing ledger as unknown, not as zero applied", () => {
    const health = schemaHealthOf({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: false, applied: [] },
    });

    expect(health.state).toBe("no-ledger");
    expect(health.appliedCount).toBeNull();
    // Not 33 "missing": nothing was compared.
    expect(health.missing).toEqual([]);
    expect(health.summary).not.toContain("一致");
    expect(health.summary).toContain("不代表結構正常");
  });

  it("does not report an empty ledger and a missing ledger the same way", () => {
    const noLedger = schemaHealthOf({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: false, applied: [] },
    });
    const emptyLedger = schemaHealthOf({
      expected: EXPECTED_MIGRATIONS,
      ledger: ledger([]),
    });

    expect(noLedger.state).toBe("no-ledger");
    expect(emptyLedger.state).toBe("behind");
    expect(noLedger.appliedCount).toBeNull();
    expect(emptyLedger.appliedCount).toBe(0);
  });

  /**
   * This repository's actual situation at the time of writing: everything up to
   * `0022` applied, `0023`-`0033` merged to main and applied to no real
   * database.
   */
  it("names the earliest missing migration when the database is behind", () => {
    // Derived, not counted by hand. `toHaveLength(11)` and `toBe(22)` would
    // start failing the day migration 0034 lands, for a reason that has nothing
    // to do with what this test is about.
    const applied = EXPECTED_MIGRATIONS.filter((id) => id < "0023");
    const unapplied = EXPECTED_MIGRATIONS.filter((id) => id >= "0023");
    const health = schemaHealthOf({ expected: EXPECTED_MIGRATIONS, ledger: ledger(applied) });

    expect(health.state).toBe("behind");
    expect(health.missing).toEqual(unapplied);
    expect(health.missing[0]).toBe("0023_document_scan_jobs_and_quarantine_retention.sql");
    expect(health.ahead).toEqual([]);
    expect(health.appliedCount).toBe(applied.length);
    expect(health.summary).toContain("0023_document_scan_jobs_and_quarantine_retention.sql");
  });

  it("reports a gap in the middle, not only a truncated tail", () => {
    const applied = EXPECTED_MIGRATIONS.filter(
      (id) => id !== "0015_officers_and_shareholdings.sql",
    );
    const health = schemaHealthOf({ expected: EXPECTED_MIGRATIONS, ledger: ledger(applied) });

    expect(health.state).toBe("behind");
    expect(health.missing).toEqual(["0015_officers_and_shareholdings.sql"]);
  });

  /**
   * The opposite emergency, and it must not be answered with "run the
   * migrator". The schema is newer than the code; migrating forward cannot help
   * and rolling back usually is not possible.
   */
  it("separates a database that is ahead from one that is behind", () => {
    const health = schemaHealthOf({
      expected: EXPECTED_MIGRATIONS,
      ledger: ledger([...EXPECTED_MIGRATIONS, "0034_something_newer.sql"]),
    });

    expect(health.state).toBe("ahead");
    expect(health.missing).toEqual([]);
    expect(health.ahead).toEqual(["0034_something_newer.sql"]);
    expect(health.summary).toContain("不要執行遷移");
  });

  it("reports divergence when it is both behind and ahead", () => {
    const applied = [
      ...EXPECTED_MIGRATIONS.filter((id) => id !== "0033_maintenance_runs.sql"),
      "0034_something_newer.sql",
    ];
    const health = schemaHealthOf({ expected: EXPECTED_MIGRATIONS, ledger: ledger(applied) });

    expect(health.state).toBe("diverged");
    expect(health.missing).toEqual(["0033_maintenance_runs.sql"]);
    expect(health.ahead).toEqual(["0034_something_newer.sql"]);
  });

  it("is current only when every expected migration is recorded", () => {
    const health = schemaHealthOf({
      expected: EXPECTED_MIGRATIONS,
      ledger: ledger([...EXPECTED_MIGRATIONS]),
    });

    expect(health.state).toBe("current");
    expect(health.missing).toEqual([]);
    expect(health.ahead).toEqual([]);
    expect(health.appliedCount).toBe(EXPECTED_MIGRATIONS.length);
  });

  it("does not depend on the order the ledger returns rows in", () => {
    const shuffled = [...EXPECTED_MIGRATIONS].reverse();
    const health = schemaHealthOf({ expected: EXPECTED_MIGRATIONS, ledger: ledger(shuffled) });

    expect(health.state).toBe("current");
  });

  it("counts distinct ids, so a duplicated ledger row cannot inflate the total", () => {
    const applied = [...EXPECTED_MIGRATIONS, "0033_maintenance_runs.sql"];
    const health = schemaHealthOf({ expected: EXPECTED_MIGRATIONS, ledger: ledger(applied) });

    expect(health.state).toBe("current");
    expect(health.appliedCount).toBe(EXPECTED_MIGRATIONS.length);
  });
});

describe("earliestMissingLabel", () => {
  /**
   * The regression this function exists for. `missing[0] ?? "—"` gave the same
   * em dash for both of these, and they are opposite facts.
   */
  it("does not show a fully migrated database and an unreadable one the same way", () => {
    const current = schemaHealthOf({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: true, applied: [...EXPECTED_MIGRATIONS] },
    });
    const noLedger = schemaHealthOf({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: false, applied: [] },
    });

    expect(earliestMissingLabel(current)).toBe("—");
    expect(earliestMissingLabel(noLedger)).toBe("無法判斷");
    expect(earliestMissingLabel(noLedger)).not.toBe(earliestMissingLabel(current));
  });

  it("names the migration when one is actually missing", () => {
    const behind = schemaHealthOf({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: true, applied: EXPECTED_MIGRATIONS.filter((id) => id < "0023") },
    });

    expect(earliestMissingLabel(behind)).toBe(
      "0023_document_scan_jobs_and_quarantine_retention.sql",
    );
  });
});
