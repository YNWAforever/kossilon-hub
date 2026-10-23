import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { exportBulkResultsForActor } from "./server-fns";
import type { JobItemResult, JobResult } from "./types";

const jobId = "60000000-0000-4000-8000-000000000001";
const actor: AuthenticatedActor = {
  authUserId: "synthetic-UC157",
  userId: "20000000-0000-4000-8000-000000000001",
  role: "Admin",
  teamId: null,
  active: true,
};
function item(ordinal: number): JobItemResult {
  return {
    ordinal,
    resourceId: `40000000-0000-4000-8000-${String(ordinal + 1).padStart(12, "0")}`,
    resourceLabel: "Synthetic company",
    state: "succeeded",
    reason: null,
    retryable: false,
    attempts: 1,
    output: {
      kind: "payment_list_export",
      caseId: "synthetic-case",
      companyName: 'Synthetic, "quoted"\ncompany',
      invoiceNumber: `INV-${ordinal}`,
      amount: 1800,
      currency: "HKD",
      status: ordinal === 2 ? "Payment received" : "Payment pending",
      receivedAmount: [0, 350.25, 1800][ordinal] ?? 0,
      balance: [1800, 1449.75, 0][ordinal] ?? 1800,
      paidAt: ordinal === 2 ? "2026-10-01T00:00:00Z" : null,
      approvalPerformed: false,
    },
  };
}
function page(items: JobItemResult[], patch: Partial<JobResult> = {}): JobResult {
  return {
    jobId,
    resource: "annual_return_case",
    operation: "payment_list_export",
    assignmentTarget: null,
    createdBy: actor.userId!,
    createdAt: "2026-10-23T00:00:00Z",
    updatedAt: "2026-10-23T01:00:00Z",
    payloadHash: "saved-scope-hash",
    state: "completed",
    total: items.length,
    counts: { succeeded: items.length },
    retryableFailedCount: 0,
    items,
    nextCursor: null,
    ...patch,
  };
}
// Independent RFC-style reader: compare round-tripped data, not the writer's quoting algorithm.
function readCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  expect(quoted).toBe(false);
  expect(row).toEqual([]);
  expect(cell).toBe("");
  return rows;
}
describe("UC157 persisted bulk export command (injected read boundary)", () => {
  it("refuses duplicate ordinals and a nonadvancing cursor without looping", async () => {
    const duplicate = vi.fn().mockResolvedValue(page([item(0), item(0)]));
    await expect(
      exportBulkResultsForActor(actor, { jobId }, { getJob: duplicate }),
    ).rejects.toThrow(/inconsistent/i);
    const repeating = vi
      .fn()
      .mockResolvedValueOnce(page([item(0)], { total: 2, nextCursor: 1 }))
      .mockResolvedValueOnce(page([item(1)], { total: 2, nextCursor: 1 }));
    await expect(
      exportBulkResultsForActor(actor, { jobId }, { getJob: repeating }),
    ).rejects.toThrow(/pagination/i);
    expect(repeating).toHaveBeenCalledTimes(2);
  });
  it("never serializes stale private output for an identity-redacted row", async () => {
    const hidden = { ...item(0), resourceId: null, output: { private: "PRIVATE_STALE_OUTPUT" } };
    const result = await exportBulkResultsForActor(
      actor,
      { jobId },
      { getJob: vi.fn().mockResolvedValue(page([hidden])) },
    );
    expect(result.csv).not.toContain("PRIVATE_STALE_OUTPUT");
    expect(readCsv(result.csv)[1]).toEqual(["", "forbidden", "access_denied", "1", ""]);
  });
  it("rejects forged input fields before reading a saved job", async () => {
    const getJob = vi.fn();
    await expect(
      exportBulkResultsForActor(actor, { jobId, actorId: "forged" }, { getJob }),
    ).rejects.toThrow();
    expect(getJob).not.toHaveBeenCalled();
  });
  it("keeps unpaid/partial/full values and currency through multiple pages and CSV quoting", async () => {
    const items = [item(0), item(1), item(2)];
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(page(items.slice(0, 2), { total: 3, nextCursor: 2 }))
      .mockResolvedValueOnce(page(items.slice(2), { total: 3 }));
    const result = await exportBulkResultsForActor(actor, { jobId }, { getJob });
    expect(result.exported).toBe(3);
    const rows = readCsv(result.csv);
    expect(rows[0]).toEqual(["item", "state", "reason", "attempts", "output_json"]);
    const outputs = rows.slice(1).map((row) => JSON.parse(row[4]));
    expect(outputs).toEqual(items.map((i) => i.output));
    expect(outputs.reduce((n, o) => n + o.receivedAmount, 0)).toBe(2150.25);
    expect(outputs.reduce((n, o) => n + o.balance, 0)).toBe(3249.75);
    expect(outputs.every((o) => o.currency === "HKD" && o.approvalPerformed === false)).toBe(true);
    expect(getJob.mock.calls.map(([, input]) => input)).toEqual([
      { jobId, cursor: undefined, limit: 100 },
      { jobId, cursor: 2, limit: 100 },
    ]);
  });
  it("preserves a redacted scope row as forbidden, without resource identity or private output", async () => {
    const hidden = {
      ...item(1),
      resourceId: null,
      resourceLabel: null,
      reason: "access_denied",
      output: null,
    };
    const getJob = vi.fn().mockResolvedValue(page([item(0), hidden]));
    const result = await exportBulkResultsForActor(actor, { jobId }, { getJob });
    expect(result.exported).toBe(2);
    expect(readCsv(result.csv)[2]).toEqual(["", "forbidden", "access_denied", "1", ""]);
  });
  it.each(["updatedAt", "payloadHash", "total", "jobId"] as const)(
    "refuses mixed saved %s across pages, and allows a fresh retry",
    async (field) => {
      const first = page([item(0)], { total: 2, nextCursor: 1 });
      const changed = page([item(1)], { total: 2, [field]: field === "total" ? 3 : "changed" });
      const getJob = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(changed);
      await expect(exportBulkResultsForActor(actor, { jobId }, { getJob })).rejects.toThrow(
        /changed|inconsistent|incomplete/i,
      );
      getJob.mockResolvedValue(page([item(0), item(1)]));
      expect((await exportBulkResultsForActor(actor, { jobId }, { getJob })).exported).toBe(2);
    },
  );
  it("refuses incomplete saved totals instead of producing a plausible partial file", async () => {
    const getJob = vi.fn().mockResolvedValue(page([item(0)], { total: 2 }));
    await expect(exportBulkResultsForActor(actor, { jobId }, { getJob })).rejects.toThrow(
      /incomplete/i,
    );
  });
  it("retains a header for a genuinely empty scope", async () => {
    const getJob = vi.fn().mockResolvedValue(page([]));
    expect(await exportBulkResultsForActor(actor, { jobId }, { getJob })).toEqual({
      csv: "item,state,reason,attempts,output_json\n",
      exported: 0,
    });
  });
  it.each([
    { ...actor, role: "Staff" as const },
    { ...actor, role: "Client" as const },
    { ...actor, active: false },
    { ...actor, userId: null },
    { ...actor, role: "Manager" as const, teamId: null },
  ])("refuses unauthorized actor before read: %j", async (denied) => {
    const getJob = vi.fn();
    await expect(exportBulkResultsForActor(denied, { jobId }, { getJob })).rejects.toThrow(
      /Forbidden/,
    );
    expect(getJob).not.toHaveBeenCalled();
  });
});
