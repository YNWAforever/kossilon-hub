import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const requiredFiles = [
  "src/server/db/schema.sql",
  "src/server/runtime-env.ts",
  "src/features/auth/neon-auth-server.ts",
  "src/features/documents/scanner.ts",
  "src/features/notifications/outbox.ts",
  "src/server/cron.ts",
];
const requiredBindings = [
  "FIRM_ID",
  "NEON_AUTH_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "DATABASE_URL",
  "DOCUMENTS_BUCKET",
  "WOZTELL_API_BASE_URL",
  "WOZTELL_ACCESS_TOKEN",
  "WOZTELL_CHANNEL_ID",
  "WOZTELL_WEBHOOK_SECRET",
  "EMAIL_FROM",
];

let failures = 0;
for (const file of requiredFiles) {
  try {
    await access(new URL(file, root));
    console.log(`PASS structure ${file}`);
  } catch {
    console.log(`FAIL structure ${file}`);
    failures += 1;
  }
}
const schema = await readFile(new URL("src/server/db/schema.sql", root), "utf8");
for (const table of [
  "notification_outbox",
  "document_upload_intents",
  "work_items",
  "escalation_events",
]) {
  const result = schema.includes(`create table if not exists ${table}`);
  console.log(`${result ? "PASS" : "FAIL"} migration table ${table}`);
  if (!result) failures += 1;
}
console.log(
  `BLOCKED live bindings ${requiredBindings.join(", ")} (dry-run does not read or print secret values)`,
);
console.log(
  "BLOCKED external provisioning: Neon Auth, R2, WOZTELL, email, malware scanner, backups",
);
console.log("PASS dry-run safety: no network calls or resource writes performed");
if (failures > 0) process.exitCode = 1;
