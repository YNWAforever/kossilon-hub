import { describe, expect, it, vi } from "vitest";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
vi.mock("@/server/db/client", () => ({
  createSqlClient: () => {
    throw new Error("No real DB in R20 unit");
  },
  getSqlClient: () => {
    throw new Error("No real DB in R20 unit");
  },
}));
vi.mock("@/features/clients/repository", () => ({
  createClientRepository: () => {
    throw new Error("No writes in R20 unit");
  },
}));
vi.mock("@/features/work-items/repository", () => ({
  ensureWorkItemForEvent: () => {
    throw new Error("No writes in R20 unit");
  },
}));
import { createIncorporationRepository } from "./repository";
import { createCorporateChangeRequestRepository } from "@/features/corporate-changes/repository";
import { listIncorporationCasePageForActor } from "./read";
import { listCorporateChangeRequestPageForActor } from "@/features/corporate-changes/read";
import { caseListPath, readCaseListSearch, type CaseListQuery } from "./case-list-query";

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: AuthenticatedActor = {
  authUserId: "auth-a",
  userId: uuid(900),
  teamId: uuid(901),
  role: "Staff",
  active: true,
};
// 300 synthetic rows, 200 authorized, repeated sort keys, long bilingual names.
const records = Array.from({ length: 300 }, (_, i) => ({
  id: uuid(i + 1),
  company_id: uuid(i + 1000),
  change_type: "address_change",
  team_id: i % 3 === 0 ? uuid(902) : uuid(901),
  team_name: "Synthetic team",
  owner_id: i % 2 ? uuid(900) : uuid(903),
  owner_name: i % 2 ? "Staff A" : "Staff B",
  proposed_company_name_en: `Venture ${String(i % 8).padStart(2, "0")} ${"Long English Name ".repeat(5)}`,
  proposed_company_name_zh: i % 5 === 0 ? "新創公司".repeat(20) : "其他公司",
  proposed_registered_office: "Synthetic office",
  proposed_company_secretary: "Synthetic secretary",
  registered_capital: 10000,
  business_nature: "Testing",
  status: i % 2 ? "Documents pending" : "Completed",
  quoted_fee: "1000",
  company_name: `Venture ${String(i % 8).padStart(2, "0")} ${i % 5 === 0 ? "新創公司".repeat(20) : "其他公司"}`,
  target_completion_date: `2026-11-${String((i % 10) + 1).padStart(2, "0")}`,
  due_date: i % 7 ? `2026-11-${String((i % 10) + 1).padStart(2, "0")}` : null,
  company_id_for_case: null,
  completed_at: null,
  created_at: `2026-10-${String((i % 10) + 1).padStart(2, "0")}T00:00:00.000000`,
}));

// Interpret only the SELECT contract emitted by production repositories. Query
// clauses and bind values drive this fake; no production filter helper is reused.
function fakeSql(domain: "incorporation" | "changes", data = records) {
  const calls: { text: string; values: unknown[]; returned: number }[] = [];
  const tag = (parts: TemplateStringsArray, ...input: unknown[]) => {
    const values: unknown[] = [];
    let text = parts[0];
    input.forEach((value, i) => {
      if (value && typeof value === "object" && "raw" in value)
        text += (value as { raw: string }).raw;
      else {
        values.push(value);
        text += `$${values.length}`;
      }
      text += parts[i + 1];
    });
    const param = (pattern: RegExp) => {
      const match = text.match(pattern);
      expect(match, `missing query predicate ${pattern}`).not.toBeNull();
      return values[Number(match![1]) - 1];
    };
    const teamIndex = text.match(
      domain === "incorporation" ? /or ic\.team_id = \$(\d+)/ : /or c\.assigned_team_id = \$(\d+)/,
    );
    expect(teamIndex).not.toBeNull();
    const team = values[Number(teamIndex![1]) - 1];
    const all = values[Number(teamIndex![1]) - 2];
    const status = param(/or (?:ic|p)\.status = \$(\d+)/);
    const owner = param(/or (?:ic|p)\.owner_id = \$(\d+)/);
    const pattern = param(/ilike \$(\d+)/) as string | null;
    const from = param(/(?:target_completion_date|due_date) >= \$(\d+)/) as string | null;
    const to = param(/(?:target_completion_date|due_date) <= \$(\d+)/) as string | null;
    const limit = Number(param(/limit \$(\d+)/));
    expect(limit).toBeLessThanOrEqual(101);
    const sort = /order by lower/.test(text)
      ? "company"
      : /order by coalesce/.test(text)
        ? "due"
        : "created";
    const valueOf = (row: (typeof records)[number]) =>
      sort === "company"
        ? (domain === "incorporation"
            ? row.proposed_company_name_en
            : row.company_name
          ).toLowerCase()
        : sort === "due"
          ? ((domain === "incorporation" ? row.target_completion_date : row.due_date) ??
            "9999-12-31")
          : row.created_at;
    const cursorTuple = text.match(/\) [<>] \(\$(\d+)(?:::text)?, \$(\d+)::uuid/)!;
    expect(cursorTuple).not.toBeNull();
    const cursorValue = values[Number(cursorTuple[1]) - 1] as string | null;
    const cursorId = values[Number(cursorTuple[2]) - 1] as string | null;
    const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const needle = pattern
      ?.slice(1, -1)
      .replace(/\\([\\%_])/g, "$1")
      .toLowerCase();
    const rows = data
      .filter((row) => {
        const due = domain === "incorporation" ? row.target_completion_date : row.due_date;
        const company =
          domain === "incorporation"
            ? `${row.proposed_company_name_en} ${row.proposed_company_name_zh}`
            : row.company_name;
        const position =
          compare(valueOf(row), cursorValue ?? "") || compare(row.id, cursorId ?? "");
        return (
          (all || row.team_id === team) &&
          (!status || row.status === status) &&
          (!owner || row.owner_id === owner) &&
          (!needle || company.toLowerCase().includes(needle)) &&
          (!from || (!!due && due >= from)) &&
          (!to || (!!due && due <= to)) &&
          (!cursorValue || (sort === "created" ? position < 0 : position > 0))
        );
      })
      .sort(
        (a, b) =>
          (compare(valueOf(a), valueOf(b)) || compare(a.id, b.id)) * (sort === "created" ? -1 : 1),
      )
      .slice(0, limit)
      .map((row) => ({ ...row, sort_value: valueOf(row) }));
    calls.push({ text, values, returned: rows.length });
    return Promise.resolve(rows);
  };
  tag.unsafe = (raw: string) => ({ raw });
  return { sql: tag as unknown as SqlClient, calls };
}

for (const domain of ["incorporation", "changes"] as const)
  describe(`${domain} list over 300 fake SQL records`, () => {
    function setup(data = records) {
      const fake = fakeSql(domain, data);
      const repository =
        domain === "incorporation"
          ? createIncorporationRepository({ sql: fake.sql })
          : createCorporateChangeRequestRepository(undefined, { sql: fake.sql });
      const page = (who: AuthenticatedActor, query: CaseListQuery) =>
        domain === "incorporation"
          ? listIncorporationCasePageForActor(who, query, {
              repository: repository as ReturnType<typeof createIncorporationRepository>,
            })
          : listCorporateChangeRequestPageForActor(who, query, {
              repository: repository as ReturnType<typeof createCorporateChangeRequestRepository>,
            });
      return { ...fake, page };
    }
    it("preserves distinct microsecond cursor keys within one millisecond as text binds", async () => {
      const data = records.slice(0, 3).map((row, i) => ({
        ...row,
        team_id: actor.teamId!,
        created_at: `2026-10-23T10:00:00.00000${[2, 1, 3][i]}`,
      }));
      const { page, calls } = setup(data);
      const first = await page(actor, { limit: 1, sort: "created" });
      expect(first.items.map((row) => row.id)).toEqual([uuid(3)]);
      expect(JSON.parse(first.nextCursor!).value).toBe("2026-10-23T10:00:00.000003");
      const second = await page(actor, { limit: 1, sort: "created", cursor: first.nextCursor! });
      expect(second.items.map((row) => row.id)).toEqual([uuid(1)]);
      expect(JSON.parse(second.nextCursor!).value).toBe("2026-10-23T10:00:00.000002");
      const third = await page(actor, { limit: 1, sort: "created", cursor: second.nextCursor! });
      expect(third.items.map((row) => row.id)).toEqual([uuid(2)]);
      expect(third.nextCursor).toBeNull();
      expect(calls[1].values).toContain("2026-10-23T10:00:00.000003");
      // Bind type is an application/driver contract. A timestamp parameter may
      // be serialized via JS Date and lose precision even if a text value was read.
      expect(calls[1].text).toMatch(/\) < \(\$\d+::text, \$\d+::uuid\)/);
    });
    it.each(["created", "company", "due"] as const)(
      "paginates all authorized records with %s ties and no gaps/duplicates",
      async (sort) => {
        const { page, calls } = setup();
        const ids: string[] = [];
        let cursor: string | undefined;
        do {
          const result = await page(actor, { sort, limit: 17, cursor });
          ids.push(...result.items.map((row) => row.id));
          cursor = result.nextCursor ?? undefined;
        } while (cursor);
        expect(ids).toHaveLength(200);
        expect(new Set(ids).size).toBe(200);
        expect(ids.every((id) => Number(id.slice(-12)) % 3 !== 1)).toBe(true);
        expect(calls.every((call) => call.returned <= 18)).toBe(true);
        expect(calls).toHaveLength(12);
      },
    );
    it("searches bilingual existing cases and intersects status, owner, due and team before the page limit", async () => {
      const { page } = setup();
      const result = await page(actor, {
        q: "新創",
        status: "Documents pending",
        ownerId: uuid(900),
        dueFrom: "2026-11-02",
        dueTo: "2026-11-06",
        limit: 100,
      });
      const expected = records
        .filter(
          (row) =>
            row.team_id === uuid(901) &&
            Number(row.id.slice(-12)) % 5 === 1 &&
            row.status === "Documents pending" &&
            (domain === "incorporation" ? row.target_completion_date : row.due_date) ===
              "2026-11-06",
        )
        .map((row) => row.id)
        .sort();
      expect(expected.length).toBeGreaterThan(0);
      expect(result.items.map((row) => row.id).sort()).toEqual(expected);
    });
    it("allows all-team Admin reads but rejects changed actor/filter cursors before SQL", async () => {
      const { page, calls } = setup();
      const first = await page({ ...actor, role: "Admin", teamId: null }, { limit: 100 });
      expect(first.items).toHaveLength(100);
      expect(first.nextCursor).not.toBeNull();
      await expect(page(actor, { limit: 100, cursor: first.nextCursor! })).rejects.toThrow(
        /cursor/,
      );
      await expect(
        page(
          { ...actor, role: "Admin", teamId: null },
          { q: "changed", limit: 100, cursor: first.nextCursor! },
        ),
      ).rejects.toThrow(/cursor/);
      expect(calls).toHaveLength(1);
    });
    it.each([
      { role: "Client" },
      { active: false },
      { teamId: null },
    ] satisfies Partial<AuthenticatedActor>[])("denies %j before query", async (overrides) => {
      const { page, calls } = setup();
      await expect(page({ ...actor, ...overrides }, {})).rejects.toThrow(/Forbidden/);
      expect(calls).toHaveLength(0);
    });
    it("rejects bad date ranges and cursor input without any query", async () => {
      const { page, calls } = setup();
      for (const query of [
        { dueFrom: "2026-11-05", dueTo: "2026-11-01" },
        { cursor: "bad" },
        { limit: 0 },
      ])
        await expect(page(actor, query)).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });
    it("retains Manager team boundaries and intersects an explicit Admin team", async () => {
      const { page, calls } = setup();
      await expect(page({ ...actor, role: "Manager" }, { teamId: uuid(902) })).rejects.toThrow(
        /Forbidden/,
      );
      expect(calls).toHaveLength(0);
      const result = await page(
        { ...actor, role: "Admin", teamId: null },
        { teamId: uuid(902), limit: 100 },
      );
      expect(result.items).toHaveLength(100);
      expect(result.items.every((row) => Number(row.id.slice(-12)) % 3 === 1)).toBe(true);
      expect(result.nextCursor).toBeNull();
    });
    it("treats SQL wildcard characters as literal company search text", async () => {
      const { page, calls } = setup();
      expect((await page(actor, { q: "_%" })).items).toEqual([]);
      expect(calls[0].values).toContain("%\\_\\%%");
    });
  });
it("round-trips the safe list URL and refuses multivalue filters", () => {
  const query: CaseListQuery = {
    q: "新創公司",
    status: "Documents pending",
    sort: "due",
    cursor: "cursor-value",
  };
  expect(readCaseListSearch(caseListPath("/incorporation", query).split("?")[1])).toEqual(query);
  expect(readCaseListSearch("?ownerId=x&ownerId=y")).toEqual({ cursor: "invalid" });
});
