import { describe, expect, it, vi } from "vitest";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { readTupleCursor } from "@/server/db/pagination";
import { readCompanyWorkPage } from "./company-work";

vi.mock("@/server/db/client", () => ({
  getSqlClient: () => {
    throw new Error("No DB client in unit tests");
  },
}));
const actor: AuthenticatedActor = {
  authUserId: "test",
  userId: "20000000-0000-0000-0000-000000000001",
  teamId: "30000000-0000-0000-0000-000000000001",
  role: "Staff",
  active: true,
};
const companyId = "10000000-0000-0000-0000-000000000001";
function queryBoundary(result: unknown[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = { text: strings.join("?"), values };
    calls.push(query);
    return {
      ...query,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
    };
  }) as unknown as SqlClient;
  return { sql, calls };
}

describe("company work bounded read boundary (no database)", () => {
  it.each([{ role: "Client" as const }, { active: false }, { userId: null }, { teamId: null }])(
    "denies an invalid staff identity before a read: %j",
    async (change) => {
      const { sql, calls } = queryBoundary([]);
      await expect(
        readCompanyWorkPage(sql, { ...actor, ...change }, { companyId }),
      ).rejects.toThrow(/Forbidden/);
      expect(calls).toHaveLength(0);
    },
  );
  it("returns scoped totals and a microsecond-preserving cursor without exposing internal row fields", async () => {
    const row = {
      id: "40000000-0000-0000-0000-000000000001",
      kind: "annual_return",
      title: "2026",
      status: "Documents pending",
      active: true,
      due_date: "2026-10-24",
      payment_status: "Payment pending",
      amount: 3000,
      cursor_created_at: "2026-10-23 01:00:00.123456+00",
    };
    const { sql, calls } = queryBoundary([
      {
        total: "3",
        unfinished: "2",
        items: [row, { ...row, id: "40000000-0000-0000-0000-000000000002" }],
      },
    ]);
    const page = await readCompanyWorkPage(sql, actor, { companyId, limit: 1 });
    expect(page).toMatchObject({
      total: 3,
      unfinished: 2,
      items: [
        { id: row.id, dueDate: "2026-10-24", paymentStatus: "Payment pending", amount: 3000 },
      ],
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty("cursor_created_at");
    expect(readTupleCursor(page.nextCursor!, 4)).toEqual([
      "1",
      "2026-10-23 01:00:00.123456+00",
      "annual_return",
      row.id,
    ]);
    const statement = calls.at(-1)!;
    expect(statement.text).toContain("union all");
    expect(statement.text).toContain("count(*) filter(where active)");
    expect(statement.values.filter((value) => value === companyId)).toHaveLength(3);
    expect(statement.values).toContain(actor.teamId);
  });
});
