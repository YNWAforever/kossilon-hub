import { describe, expect, it } from "vitest";
import { assertApplicationWriteSchema, ApplicationSchemaError } from "./application-schema";
import { schemaCatalogDouble } from "@/test/schema-catalog-double";
describe("UC189 shared application schema error", () => {
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
