import "dotenv/config";
import type postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import type { DocumentStorage } from "@/features/documents/types";
import { createReturnSourceStore } from "./return-source-store";
import { syncReturnSource, type ReturnSource } from "./return-source";

const databaseUrl = process.env.TEST_DATABASE_URL;
let db: SqlClient | undefined;
function testSql() {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL required.");
  db ??= createSqlClient(databaseUrl, { max: 2 });
  return db;
}
afterAll(async () => {
  if (db) await db.end();
});
const rollback = new Error("t16-source-rollback");
async function withFixture(work: (tx: postgres.TransactionSql) => Promise<void>) {
  try {
    await testSql().begin(async (tx) => {
      await work(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
function storage(): DocumentStorage {
  const objects = new Map<
    string,
    { body: ArrayBuffer; checksum: string; sizeBytes: number; contentType: string }
  >();
  return {
    async put(input) {
      objects.set(input.objectKey, {
        body: new Uint8Array(input.body).slice().buffer,
        checksum: input.checksum,
        sizeBytes: input.sizeBytes,
        contentType: input.contentType,
      });
      return {
        objectKey: input.objectKey,
        checksum: input.checksum,
        sizeBytes: input.sizeBytes,
        contentType: input.contentType,
      };
    },
    async get(key) {
      const value = objects.get(key);
      return value ? { ...value, objectKey: key } : null;
    },
    async head(key) {
      const value = objects.get(key);
      return value
        ? {
            objectKey: key,
            checksum: value.checksum,
            sizeBytes: value.sizeBytes,
            contentType: value.contentType,
          }
        : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
describe.skipIf(!databaseUrl)("T16 return source cursor on disposable Postgres", () => {
  it("keeps cursor after interruption, quarantines unsafe bytes and versions a changed object", async () => {
    await withFixture(async (tx) => {
      const sourceKey = "t16-" + crypto.randomUUID();
      const store = createReturnSourceStore(tx);
      const quarantine = storage();
      let failSecond = true;
      let version = "v1";
      const source: ReturnSource = {
        async list(cursor) {
          return cursor === null
            ? {
                items: [
                  { objectId: "same-name.pdf", version, stable: true },
                  { objectId: "second.pdf", version: "v1", stable: true },
                ],
                nextCursor: "page-2",
              }
            : {
                items: [{ objectId: "same-name.pdf", version: "v2", stable: true }],
                nextCursor: "page-3",
              };
        },
        async read(objectId) {
          if (objectId === "second.pdf" && failSecond) throw new Error("disconnect");
          return {
            objectId,
            version: objectId === "same-name.pdf" ? version : "v1",
            fileName: "response.pdf",
            contentType: "application/pdf",
            stable: true,
            body: new TextEncoder().encode("%PDF-1.7 " + objectId + version),
          };
        },
      };
      const dependencies = {
        store,
        storage: quarantine,
        scanner: {
          async scan() {
            return {
              status: "rejected" as const,
              reason: "malware",
              providerReference: "scan-unsafe",
            };
          },
        },
      };
      await expect(syncReturnSource(sourceKey, source, dependencies)).rejects.toThrow(/disconnect/);
      const [held] = await tx<{ cursor: string | null; lease_token: string | null }[]>`
        select cursor,lease_token from filing_return_source_cursors
        where source_key = ${sourceKey}`;
      expect(held).toMatchObject({ cursor: null, lease_token: null });
      failSecond = false;
      expect(await syncReturnSource(sourceKey, source, dependencies)).toMatchObject({
        state: "advanced",
        cursor: "page-2",
        staged: 2,
      });
      version = "v2";
      expect(await syncReturnSource(sourceKey, source, dependencies)).toMatchObject({
        state: "advanced",
        cursor: "page-3",
        staged: 1,
      });
      const rows = await tx<{ object_id: string; scan_state: string }[]>`
        select object_id,scan_state from filing_return_source_objects
        where source_key = ${sourceKey} order by first_seen_at,id`;
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.scan_state === "unsafe")).toBe(true);
      expect(rows.filter((row) => row.object_id === "same-name.pdf")).toHaveLength(2);
    });
  });
});
