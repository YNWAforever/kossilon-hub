import { describe, expect, it, vi } from "vitest";
import type { SqlClient } from "@/server/db/client";

// Only an inert query recorder may be injected. No DB module/client is loaded.
vi.mock("@/server/db/client", () => ({
  createSqlClient: () => {
    throw new Error("Real DB client forbidden in R14 unit tests");
  },
  getSqlClient: () => {
    throw new Error("Real DB client forbidden in R14 unit tests");
  },
}));
import { createIncorporationRepository } from "./repository";

function recorder(results: unknown[][] = [[]]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: parts.join("?"), values });
    return results.shift() ?? [];
  };
  return {
    queries,
    repository: createIncorporationRepository({ sql: sql as unknown as SqlClient }),
  };
}

describe("incorporation repository read query contracts (unit recorder)", () => {
  it("applies the team predicate in SQL before search, ordering, and page bounds", async () => {
    const { repository, queries } = recorder();
    await repository.listCases(
      { kind: "team", teamId: "team-a" },
      {
        q: "新_%",
        ownerId: "owner-a",
        limit: 10,
        offset: 20,
      },
    );
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(
      /where[\s\S]*ic\.team_id[\s\S]*ilike[\s\S]*order by ic\.created_at desc, ic\.id desc[\s\S]*limit \?[\s\S]*offset \?/,
    );
    expect(queries[0].values).toContain("team-a");
    expect(queries[0].values).toContain("owner-a");
    expect(queries[0].values).toContain("%新\\_\\%%");
    expect(queries[0].values.slice(-2)).toEqual([10, 20]);
  });

  it("makes Admin all-team scope explicit instead of accidentally dropping a missing team", async () => {
    const { repository, queries } = recorder();
    await repository.listCases({ kind: "all" });
    expect(queries[0].values[0]).toBe(true);
    expect(queries[0].values[1]).toBeNull();
  });

  it("scopes detail in SQL and does not load checklist content for an invisible case", async () => {
    const { repository, queries } = recorder();
    await expect(
      repository.getCase("case-b", { kind: "team", teamId: "team-a" }),
    ).resolves.toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/where ic\.id = \?[\s\S]*ic\.team_id/);
    expect(queries[0].values).toEqual(["case-b", false, "team-a"]);
  });

  it("keeps checklist hydration within the same team even after the case query", async () => {
    const { repository, queries } = recorder([
      [
        {
          id: "case-a",
          proposed_company_name_en: "New Venture Limited",
          proposed_company_name_zh: "新創有限公司",
          proposed_registered_office: "1 Test Street",
          proposed_company_secretary: "Test Secretary",
          registered_capital: 10000,
          business_nature: "Trading",
          status: "Intake",
          owner_id: "owner-a",
          owner_name: "Staff A",
          team_id: "team-a",
          team_name: "Team A",
          target_completion_date: "2026-11-01",
          company_id: null,
          completed_at: null,
          created_at: "2026-10-23T00:00:00.000Z",
        },
      ],
      [],
    ]);
    const result = await repository.getCase("case-a", { kind: "team", teamId: "team-a" });
    expect(result).toMatchObject({ id: "case-a", teamId: "team-a", checklist: [] });
    expect(queries).toHaveLength(2);
    expect(queries[1].text).toMatch(
      /from incorporation_checklist_items[\s\S]*exists[\s\S]*ic\.team_id/,
    );
    expect(queries[1].values).toEqual(["case-a", "case-a", false, "team-a"]);
  });

  it("preserves the unpaged legacy call while requiring explicit scope", async () => {
    const { repository, queries } = recorder();
    await repository.listCases({ kind: "team", teamId: "team-a" });
    expect(queries[0].values.slice(-2)).toEqual([null, 0]);
  });

  it.each([{ limit: 0 }, { limit: 501 }, { limit: 1.5 }, { offset: -1 }, { offset: 0.5 }])(
    "rejects invalid page bounds %j before emitting SQL",
    async (query) => {
      const { repository, queries } = recorder();
      await expect(
        repository.listCases({ kind: "team", teamId: "team-a" }, query),
      ).rejects.toThrow();
      expect(queries).toHaveLength(0);
    },
  );
});
