import { describe, expect, it, vi } from "vitest";
import type { SqlClient } from "@/server/db/client";
import { createBulkOperationsRepository } from "./repository";
// Pure SQL emission contract: no driver, DB client, connection or SQL execution.
vi.mock("@/server/db/client", () => ({
  getSqlClient: () => {
    throw new Error("DB clients prohibited in this unit test");
  },
}));
vi.mock("./actions", () => ({ MAINTENANCE_ACTIONS: {}, lockMaintenanceResource: vi.fn() }));
const actor = {
  authUserId: "synthetic-r18",
  userId: "20000000-0000-0000-0000-000000000001",
  role: "Manager" as const,
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};
const caseId = "40000000-0000-0000-0000-000000000001";
type Statement = { text: string; values: unknown[] };
function recorder() {
  const calls: Statement[] = [];
  const tag = (parts: TemplateStringsArray, ...values: unknown[]) => {
    const statement: Statement = { text: parts[0], values: [] };
    values.forEach((value, index) => {
      if (value && typeof value === "object" && "text" in value && "values" in value) {
        const fragment = value as Statement;
        statement.text += fragment.text;
        statement.values.push(...fragment.values);
      } else {
        statement.text += "?";
        statement.values.push(value);
      }
      statement.text += parts[index + 1];
    });
    return {
      ...statement,
      then(resolve: (rows: unknown[]) => void) {
        calls.push(statement);
        if (statement.text.includes("from users u join staff_profiles"))
          return resolve([{ user_id: actor.userId, role: actor.role, team_id: actor.teamId }]);
        if (statement.text.startsWith("insert into bulk_selection_snapshots"))
          return resolve([{ id: caseId, expires_at: "2026-10-23T01:00:00Z" }]);
        if (statement.text.includes("from bulk_operation_jobs"))
          return resolve([
            {
              id: caseId,
              actor_user_id: actor.userId,
              auth_user_id: actor.authUserId,
              resource: "annual_return_case",
              action_key: "follow_up_draft",
              assignment: { kind: "follow_up_draft" },
              state: "partial",
              total: 2,
              payload_hash: "trusted-payload-hash",
              created_at: "2026-10-23T00:00:00Z",
              updated_at: "2026-10-23T00:00:05Z",
            },
          ]);
        if (statement.text.includes("group by state")) return resolve([{ state: "unknown", n: 2 }]);
        if (statement.text.includes("count(*)")) return resolve([{ n: 0 }]);
        return resolve([]);
      },
    };
  };
  return {
    sql: Object.assign(tag, { json: (value: unknown) => value }) as unknown as SqlClient,
    calls,
  };
}
describe("draft snapshot SQL contract", () => {
  for (const draftCaseIds of [[caseId], []])
    it(`retains the displayed restriction (${draftCaseIds.length} cases) alongside authorization`, async () => {
      const { sql, calls } = recorder();
      const result = await createBulkOperationsRepository({ sql }).createSnapshot(actor, {
        resource: "annual_return_case",
        filters: { draftCaseIds },
      });
      const query = calls.find((c) => c.text.startsWith("select arc.id"))!;
      expect(query.values).toContainEqual(draftCaseIds);
      expect(query.values).toContain(actor.teamId);
      expect(result.count).toBe(0);
      const saved = calls.find((c) => c.text.startsWith("insert into bulk_selection_snapshots"))!;
      expect(saved.values).toContain(actor.userId);
      expect(saved.values).toContain(actor.authUserId);
      expect(saved.values).toContainEqual({ draftCaseIds });
    });
  it("rejects draft case restrictions for other resources instead of silently discarding them", async () => {
    const { sql } = recorder();
    await expect(
      createBulkOperationsRepository({ sql }).createSnapshot(actor, {
        resource: "work_item",
        filters: { draftCaseIds: [caseId] },
      }),
    ).rejects.toThrow("Unsupported filters");
  });
  it("returns persisted operation, actor and progress timestamps without promoting unknown results", async () => {
    const { sql } = recorder();
    const job = await createBulkOperationsRepository({ sql }).getJob(actor, { jobId: caseId });
    expect(job).toMatchObject({
      operation: "follow_up_draft",
      createdBy: actor.userId,
      createdAt: "2026-10-23T00:00:00Z",
      updatedAt: "2026-10-23T00:00:05Z",
      payloadHash: "trusted-payload-hash",
      state: "partial",
      counts: { unknown: 2 },
      retryableFailedCount: 0,
    });
  });
});
