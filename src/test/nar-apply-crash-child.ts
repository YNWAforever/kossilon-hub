// Isolated integration-test process: the parent kills it after one real SQL commit.
import { z } from "zod";
import { createSqlClient } from "../server/db/client";
import { createNarApplyRepository, runNarApplyChunk } from "../features/nar-import/apply";
import type { AuthenticatedActor } from "../features/auth/types";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname))
  throw new Error("Crash harness requires an owned local PostgreSQL target.");
const actor = z
  .object({
    userId: z.string().uuid(),
    authUserId: z.string().startsWith("synthetic-nar-"),
    role: z.literal("Admin"),
    teamId: z.string().uuid(),
    active: z.literal(true),
  })
  .strict()
  .parse(JSON.parse(process.env.NAR_CRASH_ACTOR_JSON ?? "null")) satisfies AuthenticatedActor;
const jobId = z.string().uuid().parse(process.env.NAR_CRASH_JOB_ID);
const sql = createSqlClient(databaseUrl, { ssl: false, max: 1 });
try {
  await runNarApplyChunk({
    repository: createNarApplyRepository({ sql }),
    actor,
    jobId,
    afterCommit: async () => {
      process.stdout.write("NAR_ITEM_COMMITTED\n");
      await new Promise<void>(() => {
        setInterval(() => {}, 1000);
      });
    },
  });
} finally {
  await sql.end();
}
