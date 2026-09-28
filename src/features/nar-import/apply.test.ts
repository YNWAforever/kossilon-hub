import { describe, expect, it } from "vitest";
import type { ImportPreviewRow } from "./preview";
import { assertDistinctImportTargets, importLogicalKey, planImportedRow } from "./apply";

function previewRow(overrides: Partial<ImportPreviewRow> = {}): ImportPreviewRow {
  return {
    rowId: "11111111-1111-4111-8111-111111111111",
    rowRevision: 1,
    rowNumber: 2,
    externalClientId: "X10001",
    matchedCompanyId: "22222222-2222-4222-8222-222222222222",
    matchedCaseId: null,
    caseSnapshot: null,
    disposition: "new",
    issues: [],
    fields: [
      {
        field: "filingDueDate",
        before: null,
        after: "2025-08-12",
        source: "workbook:G2",
        policy: "candidate",
      },
      {
        field: "paymentObservedDate",
        before: null,
        after: "2025-08-13",
        source: "workbook:F2",
        policy: "observation-only",
      },
      {
        field: "invoiceReference",
        before: null,
        after: null,
        source: "workbook:E2",
        policy: "observation-only",
      },
    ],
    ...overrides,
  };
}

describe("T11 import approval and apply policy", () => {
  it("t11_scenario_1 replays the same semantic preview with one logical operation", () => {
    expect(importLogicalKey("raw:sheet:2025:parser:0", "a".repeat(64))).toBe(
      importLogicalKey("raw:sheet:2025:parser:0", "a".repeat(64)),
    );
    expect(planImportedRow(previewRow(), null).kind).toBe("create");
  });
  it("t11_scenario_2 refuses a case changed after preview instead of overwriting", () => {
    const snapshot = {
      status: "Upcoming",
      updatedAt: "2026-01-01T00:00:00.000Z",
      filingDueDate: "2025-08-10",
    };
    const row = previewRow({
      disposition: "updated",
      matchedCaseId: "33333333-3333-4333-8333-333333333333",
      caseSnapshot: snapshot,
    });
    expect(
      planImportedRow(row, {
        id: row.matchedCaseId!,
        status: "Upcoming",
        updatedAt: "2026-01-02T00:00:00.000Z",
        filingDueDate: "2025-08-11",
      }).kind,
    ).toBe("conflict");
  });
  it("t11_scenario_3 rejects two source rows targeting the same company and year", () => {
    expect(() =>
      assertDistinctImportTargets(
        [
          previewRow(),
          previewRow({
            rowId: "44444444-4444-4444-8444-444444444444",
            rowNumber: 3,
            externalClientId: "X10002",
          }),
        ],
        2025,
      ),
    ).toThrow(/same company and return year/i);
  });
  it("t11_scenario_4 preserves Filed and blank/Nil human values; payment stays observation", () => {
    const snapshot = {
      status: "Filed",
      updatedAt: "2026-01-01T00:00:00.000Z",
      filingDueDate: "2025-08-10",
    };
    const row = previewRow({
      disposition: "unchanged",
      matchedCaseId: "33333333-3333-4333-8333-333333333333",
      caseSnapshot: snapshot,
      fields: [
        {
          field: "filingDueDate",
          before: "2025-08-10",
          after: null,
          source: "workbook:G2",
          policy: "preserve-human",
        },
        {
          field: "paymentObservedDate",
          before: null,
          after: "2025-08-13",
          source: "workbook:F2",
          policy: "observation-only",
        },
      ],
    });
    const plan = planImportedRow(row, { id: row.matchedCaseId!, ...snapshot });
    expect(plan.kind).toBe("skip");
    expect(plan.filingDueDate).toBe("2025-08-10");
    expect(plan.paymentObservedDate).toBe("2025-08-13");
  });
});
