/**
 * Test files that read and write the real Postgres named by TEST_DATABASE_URL.
 *
 * They share one database with no per-file schema or transaction isolation, so
 * vite.config.ts runs them as a serialized `db` project. Keep this list in sync
 * with reality — db-integration-files.convention.test.ts enforces it.
 */
export const DB_INTEGRATION_TEST_FILES = [
  "scripts/inspect-schema-compatibility.test.ts",
  "src/features/annual-return/repository.test.ts",
  "src/features/checklist-templates/repository.test.ts",
  "src/features/clients/repository.test.ts",
  "src/features/corporate-changes/repository.test.ts",
  "src/features/documents/repository.integration.test.ts",
  "src/features/incorporation/repository.test.ts",
  "src/features/notifications/delivery-attempts.test.ts",
  "src/features/notifications/outbox.integration.test.ts",
  "src/features/operations/repository.integration.test.ts",
  "src/features/service-subscriptions/repository.test.ts",
  "src/features/whatsapp/repository.test.ts",
  "src/features/work-items/repository.test.ts",
] as const;
