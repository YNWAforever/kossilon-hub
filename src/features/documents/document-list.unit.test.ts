import { describe, expect, it, vi } from "vitest";
import type { SqlClient } from "@/server/db/client";
import { readTupleCursor } from "@/server/db/pagination";
import { createDocumentRepository } from "./repository";
import { documentListPageSchema, listDocumentPageForActor } from "./server-fns";
import { createBulkOperationsRepository } from "@/features/bulk-operations/repository";

// A recording SQL boundary only: never construct a driver, connection or storage adapter.
vi.mock("@/server/db/client", () => ({
  getSqlClient: () => {
    throw new Error("Database access is forbidden in this unit test");
  },
  createSqlClient: () => {
    throw new Error("Database access is forbidden in this unit test");
  },
}));

function recordingSql(rows: unknown[] | ((text: string) => unknown[])) {
  const queries: { text: string; values: unknown[] }[] = [];
  const sql = ((parts: TemplateStringsArray, ...args: unknown[]) => {
    const values: unknown[] = [];
    let text = parts[0];
    args.forEach((arg, index) => {
      if (arg && typeof arg === "object" && "text" in arg && "values" in arg) {
        const fragment = arg as { text: string; values: unknown[] };
        text += fragment.text;
        values.push(...fragment.values);
      } else {
        text += "?";
        values.push(arg);
      }
      text += parts[index + 1];
    });
    const query = { text, values };
    queries.push(query);
    return {
      ...query,
      then: (resolve: (value: unknown[]) => unknown) =>
        Promise.resolve(typeof rows === "function" ? rows(text) : rows).then(resolve),
    };
  }) as unknown as SqlClient;
  sql.json = ((value: unknown) => JSON.stringify(value)) as unknown as SqlClient["json"];
  return { sql, queries };
}

const row = {
  id: "10000000-0000-0000-0000-000000000001",
  company_id: "20000000-0000-0000-0000-000000000001",
  case_id: "30000000-0000-0000-0000-000000000001",
  file_type: "payment",
  file_name: "proof.pdf",
  storage_url: "private/proof",
  upload_source: "client",
  verification_status: "verified",
  uploaded_by: null,
  uploaded_at: "2026-10-23T01:00:00Z",
  cursor_uploaded_at: "2026-10-23 01:00:00.123456+00",
  content_type: "application/pdf",
  expected_size_bytes: "20",
  checksum_sha256: "a".repeat(64),
  upload_status: "available",
  scan_verdict_source: "provider",
  current_version_id: "40000000-0000-0000-0000-000000000001",
  scan_document_version_id: "40000000-0000-0000-0000-000000000001",
  reviewed_document_version_id: "40000000-0000-0000-0000-000000000001",
  intent_id: "50000000-0000-0000-0000-000000000001",
  verified_checksum_sha256: "a".repeat(64),
};

describe("document register query contract (no database)", () => {
  it("accepts source and current-version review filters without changing the page protocol", () => {
    const result = documentListPageSchema.safeParse({
      source: "client",
      reviewStatus: "pending",
      category: "payment",
      limit: 2,
    });
    expect(result.success).toBe(true);
    expect(documentListPageSchema.safeParse({ source: "invented" }).success).toBe(false);
    expect(documentListPageSchema.safeParse({ reviewStatus: "approved" }).success).toBe(false);
    expect(documentListPageSchema.safeParse({ includeFixtures: true }).success).toBe(false);
  });

  it("binds all global filters before the page limit and treats wildcard input literally", async () => {
    const { sql, queries } = recordingSql([]);
    const repository = createDocumentRepository({ sql });
    await repository.listDocumentPage({
      q: "  A_50%  ",
      category: "payment",
      source: "client",
      reviewStatus: "pending",
      limit: 2,
    });
    const query = queries.at(-1)!;
    expect(query.values).toContain("client");
    expect(query.values).toContain("pending");
    expect(query.values).toContain("payment");
    expect(query.values).toContain("%A\\_50\\%%");
    const predicate = query.text.slice(0, query.text.indexOf("order by d.uploaded_at"));
    expect(predicate).toContain("d.upload_source");
    expect(predicate).toContain("d.reviewed_document_version_id");
    expect(predicate).toContain("superseded_by_version_id is null");
    expect(predicate).toContain("c.company_name ilike");
  });

  it.each([
    ["no intent", { intent_id: null }, "metadata_only", "verified"],
    ["no current version", { current_version_id: null }, "metadata_only", "pending"],
    ["quarantine", { upload_status: "quarantined" }, "quarantined", "verified"],
    ["old scan", { scan_document_version_id: "old" }, "unscanned", "verified"],
    ["old review", { reviewed_document_version_id: "old" }, "available", "pending"],
  ] as const)(
    "retains %s metadata and explains its effective state",
    async (_label, overrides, availability, reviewStatus) => {
      const { sql } = recordingSql([{ ...row, ...overrides }]);
      const page = await createDocumentRepository({ sql }).listDocumentPage();
      expect(page.documents).toHaveLength(1);
      expect(page.documents[0]).toMatchObject({
        availability,
        reviewStatus,
        objectAvailability: "not_checked",
      });
    },
  );

  it("keeps the timestamp microseconds and id boundary for tied upload times", async () => {
    const rows = [
      row,
      { ...row, id: "10000000-0000-0000-0000-000000000002" },
      { ...row, id: "10000000-0000-0000-0000-000000000003" },
    ];
    const { sql } = recordingSql(rows);
    const page = await createDocumentRepository({ sql }).listDocumentPage({ limit: 2 });
    expect(page.documents.map((document) => document.id)).toEqual([rows[0].id, rows[1].id]);
    expect(readTupleCursor(page.nextCursor!, 2)).toEqual([
      "2026-10-23 01:00:00.123456+00",
      rows[1].id,
    ]);
  });

  it("uses the same global filters for a bulk snapshot and its count", async () => {
    const { sql, queries } = recordingSql((text) => {
      if (text.includes("from users"))
        return [{ user_id: row.company_id, role: "Admin", team_id: null }];
      if (text.includes("insert into bulk_selection_snapshots"))
        return [{ id: row.intent_id, expires_at: "2026-10-23T02:00:00Z" }];
      return [{ ...row, version: "version-token", label: row.file_name, locked: false }];
    });
    const snapshot = await createBulkOperationsRepository({ sql }).createSnapshot(
      {
        authUserId: "test-admin",
        userId: row.company_id,
        role: "Admin",
        teamId: null,
        active: true,
      },
      {
        resource: "document",
        filters: { q: "Acme", category: "payment", source: "client", reviewStatus: "pending" },
      },
    );
    expect(snapshot.count).toBe(1);
    const documentQuery = queries.find((query) => query.text.includes("from documents d"))!;
    expect(documentQuery.text).toContain("c.company_name ilike");
    expect(documentQuery.values).toContain("client");
    expect(documentQuery.values).toContain("pending");
    expect(documentQuery.text).toContain("d.reviewed_document_version_id");
  });
  it("executes one complete statement even through an immediate async executor", async () => {
    const executions: string[] = [];
    const sql = (async (parts: TemplateStringsArray) => {
      executions.push(parts.join("?"));
      return [];
    }) as unknown as SqlClient;
    await createDocumentRepository({ sql }).listDocumentPage({ q: "proof" });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toContain("with page as materialized");
  });
  it("excludes fixtures at the production RPC boundary while retaining diagnostic repository reads", async () => {
    const { sql, queries } = recordingSql([]);
    const repository = createDocumentRepository({ sql });
    const pageRead = vi.spyOn(repository, "listDocumentPage");
    await listDocumentPageForActor(
      {
        authUserId: "test-admin",
        userId: row.company_id,
        role: "Admin",
        teamId: null,
        active: true,
      },
      { includeFixtures: true },
      { repository, authorizeDocument: async () => {} },
    );
    expect(queries.at(-1)!.text).toContain("c.data_origin<>'fixture'");
    expect(pageRead).toHaveBeenLastCalledWith({ includeFixtures: false });
  });
});
