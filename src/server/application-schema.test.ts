import { describe, expect, it } from "vitest";
import { assertApplicationWriteSchema, ApplicationSchemaError } from "./application-schema";
import {
  EXPECTED_MIGRATIONS,
  HISTORICAL_MIGRATIONS,
  HISTORICAL_RELEASE_RECEIPT,
} from "@/features/operations/schema-health";
import { schemaCatalogDouble } from "@/test/schema-catalog-double";
describe("UC189 shared application schema error", () => {
  const historicalLedger = {
    present: true as const,
    applied: [
      ...EXPECTED_MIGRATIONS.filter((id) => id < "0034"),
      ...HISTORICAL_MIGRATIONS,
      "0083_request_access_requests.sql",
    ],
  };
  it("admits the reconciled historical lineage when the release receipt and facts hold", async () => {
    const { state, sql } = schemaCatalogDouble();
    state.ledger = historicalLedger;
    state.receipt = {
      id: HISTORICAL_RELEASE_RECEIPT.id,
      payloadSha256: HISTORICAL_RELEASE_RECEIPT.payloadSha256,
    };

    await expect(assertApplicationWriteSchema(sql)).resolves.toBeUndefined();
  });
  it("refuses the historical ledger when the release receipt is missing", async () => {
    const { state, sql } = schemaCatalogDouble();
    state.ledger = historicalLedger;
    state.receipt = null;

    await expect(assertApplicationWriteSchema(sql)).rejects.toBeInstanceOf(ApplicationSchemaError);
  });
  it("replaces private SQL failures with a retryable, non-secret error", async () => {
    const { state, sql } = schemaCatalogDouble();
    state.readFailure = true;
    const error: unknown = await assertApplicationWriteSchema(sql).catch((error) => error);
    expect(error).toBeInstanceOf(ApplicationSchemaError);
    expect(error).toMatchObject({ statusCode: 503, code: "SCHEMA_WRITE_BLOCKED" });
    expect(String(error)).not.toContain("private database");
    expect(JSON.stringify(error)).not.toContain("credential");
  });
  it("allows a verified catalog then refuses changed facts on the next invocation", async () => {
    const { state, sql } = schemaCatalogDouble();
    await assertApplicationWriteSchema(sql);
    state.index = false;
    await expect(assertApplicationWriteSchema(sql)).rejects.toBeInstanceOf(ApplicationSchemaError);
  });
});
