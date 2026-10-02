import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { auditSchemaReadiness } from "../src/features/operations/schema-health.ts";
import { readSchemaCatalog } from "../src/features/operations/schema-catalog.ts";

export async function runSchemaReadinessAudit(
  databaseUrl: string,
  migrationsDir = resolve("db/migrations"),
) {
  const expected = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const expectedHashes = Object.fromEntries(
    await Promise.all(
      expected.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(resolve(migrationsDir, file)))
          .digest("hex"),
      ]),
    ),
  );
  const sslSetting = (process.env.DATABASE_SSL ?? process.env.PGSSLMODE ?? "require").toLowerCase();
  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: ["disable", "disabled", "false", "off", "0", "no"].includes(sslSetting)
      ? false
      : "require",
    onnotice: () => undefined,
  });
  try {
    return await sql.begin("read only", async (tx) => {
      const catalog = await readSchemaCatalog(tx);
      return {
        scope:
          "migration IDs/hashes and outbox dispatch-marker column/index; not a proof of all application DDL",
        ...auditSchemaReadiness({ expected, expectedHashes, ...catalog }),
      };
    });
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the read-only schema audit.");
  try {
    console.log(JSON.stringify(await runSchemaReadinessAudit(url), null, 2));
  } catch {
    console.error(
      "Schema audit failed; verify access/configuration. Connection details are not printed.",
    );
    process.exitCode = 1;
  }
}
