import { beforeEach, describe, expect, it, vi } from "vitest";
import { schemaCatalogDouble } from "@/test/schema-catalog-double";
const fixture = vi.hoisted(() => ({ sql: undefined as unknown, factories: 0 }));
vi.mock("@/server/db/client", () => ({
  getSqlClient: () => fixture.sql,
  createSqlClient: () => {
    throw new Error("Real client forbidden");
  },
}));
vi.mock("@/features/operations/repository", () => ({
  createMaintenanceRunRepository: () => {
    fixture.factories++;
    throw new Error("Manual recorder reached before schema admission");
  },
}));
import { runFirmMaintenance } from "./maintenance";
beforeEach(() => {
  fixture.factories = 0;
});
describe("UC189 manual maintenance production entry", () => {
  it("refuses before recorder/provider factory assembly", async () => {
    const { state, sql } = schemaCatalogDouble();
    state.marker = false;
    fixture.sql = sql;
    await expect(runFirmMaintenance({ now: "2026-10-24T07:00:00.000Z" })).rejects.toMatchObject({
      statusCode: 503,
      code: "SCHEMA_WRITE_BLOCKED",
    });
    expect(fixture.factories).toBe(0);
  });
});
