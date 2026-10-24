import { describe, expect, it } from "vitest";
import { schemaCatalogDouble } from "@/test/schema-catalog-double";
import { createAnnualReturnRepository } from "./repository";
import type { SqlClient } from "@/server/db/client";

describe("UC189 GET-triggered party synchronization", () => {
  it("refuses schema incompatibility before its INSERT, including retries", async () => {
    const { state, sql } = schemaCatalogDouble();
    state.index = false;
    const writes: string[] = [];
    const transport = ((parts: TemplateStringsArray, ...values: unknown[]) => {
      if (!Array.isArray(parts) || !/^\s*(select|insert|update|delete)/i.test(parts.join("")))
        return [];
      if (parts.join("").includes("insert into case_parties")) {
        writes.push(parts.join(""));
        return Promise.resolve([]);
      }
      return Reflect.apply(sql, undefined, [parts, ...values]);
    }) as unknown as SqlClient;
    const repository = createAnnualReturnRepository({ sql: transport });
    for (let n = 0; n < 2; n++) {
      await expect(
        repository.syncCasePartiesFromOfficers("5aa3e18c-0193-4193-8193-000000000001"),
      ).rejects.toMatchObject({ statusCode: 503, code: "SCHEMA_WRITE_BLOCKED" });
    }
    expect(writes).toEqual([]);
  });
});
