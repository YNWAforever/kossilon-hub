import { describe, expect, it } from "vitest";
import { auditSchemaReadiness } from "./schema-health";
import { assertMigrationPreflight } from "./schema-catalog";

const expected = ["0034_notification_outbox_dispatch_marker.sql"];
const facts = [
  {
    key: "notification_outbox.dispatch_started_attempt",
    present: true,
    observed: "integer",
    expected: "integer",
  },
];

describe("physical schema readiness is independent of migration history", () => {
  it("blocks an empty ledger over existing application tables", () => {
    expect(() =>
      assertMigrationPreflight({
        expected,
        ledger: { present: true, applied: [] },
        applicationPresent: true,
        facts: [],
      }),
    ).toThrow("empty ledger");
  });
  it("blocks a recorded hash mismatch", () => {
    expect(() =>
      assertMigrationPreflight({
        expected,
        expectedHashes: { [expected[0]]: "sha-a" },
        ledger: { present: true, applied: expected, hashes: { [expected[0]]: "sha-b" } },
        applicationPresent: true,
        facts,
      }),
    ).toThrow("hash mismatch");
  });
  it("reports existing DDL and missing ledger separately, with unknown ledger hashes", () => {
    const result = auditSchemaReadiness({
      expected,
      ledger: { present: false, applied: [] },
      facts,
    });
    expect(result.ledger.state).toBe("no-ledger");
    expect(result.physicalState).toBe("verified");
    expect(result.classification).toBe("ledger-only");
    expect(result.hashes[0].recorded).toBeNull();
    expect(result.safeToMigrate).toBe(false);
  });

  it("does not mistake a recorded migration for the actual column", () => {
    const result = auditSchemaReadiness({
      expected,
      ledger: { present: true, applied: expected },
      facts: [{ ...facts[0], present: false, observed: null }],
    });
    expect(result.ledger.state).toBe("current");
    expect(result.physicalState).toBe("missing-ddl");
    expect(result.classification).toBe("missing-ddl");
    expect(result.safeToMigrate).toBe(false);
  });

  it("keeps a historical basename alias unrecognised until equivalence has evidence", () => {
    const input = {
      expected: ["0008_client_register.sql"],
      ledger: { present: true, applied: ["0006_client_register.sql"] },
      facts,
    };
    const unverified = auditSchemaReadiness({
      ...input,
      aliases: [
        {
          expectedId: "0008_client_register.sql",
          recordedId: "0006_client_register.sql",
          equivalent: false,
          evidence: "same basename only",
        },
      ],
    });
    expect(unverified.unknownIds).toEqual(["0006_client_register.sql"]);
    expect(unverified.reconciledAliases).toEqual([]);
    const proven = auditSchemaReadiness({
      ...input,
      aliases: [
        {
          expectedId: "0008_client_register.sql",
          recordedId: "0006_client_register.sql",
          equivalent: true,
          evidence: "reviewed SQL hashes and catalog comparison evidence/report.json",
        },
      ],
    });
    expect(proven.unknownIds).toEqual([]);
    expect(proven.reconciledAliases).toHaveLength(1);
    // No ledger rewrite or silent claim that the old ledger is current.
    expect(proven.ledger.state).toBe("diverged");
    expect(proven.safeToMigrate).toBe(false);
  });

  it("reports unknown IDs without claiming they prove missing DDL or a newer deployment", () => {
    const result = auditSchemaReadiness({
      expected,
      ledger: { present: true, applied: [...expected, "0034_unrelated_history.sql"] },
      facts,
    });
    expect(result.unknownIds).toEqual(["0034_unrelated_history.sql"]);
    expect(result.physicalState).toBe("verified");
    expect(result.classification).toBe("ledger-only");
    expect(result.ledger.summary).not.toContain("代表它已被較新的部署");
  });

  it("requires physical observations, and separately exposes a recorded hash mismatch", () => {
    const result = auditSchemaReadiness({
      expected,
      expectedHashes: { [expected[0]]: "sha-a" },
      ledger: { present: true, applied: expected, hashes: { [expected[0]]: "sha-b" } },
      facts: [{ ...facts[0], present: null, observed: null }],
    });
    expect(result.physicalState).toBe("unknown");
    expect(result.hashes[0].state).toBe("mismatch");
    expect(result.safeToMigrate).toBe(false);
  });
});
