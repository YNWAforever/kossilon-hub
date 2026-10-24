import { getSqlClient } from "./db/client";
import { readSchemaCatalog } from "@/features/operations/schema-catalog";
import { assertMaintenanceSchema } from "./maintenance-schema";

export class ApplicationSchemaError extends Error {
  readonly statusCode = 503;
  readonly code = "SCHEMA_WRITE_BLOCKED";
  constructor() {
    super("資料庫結構不相容或無法核實，操作未執行。請查看系統運作後重試。");
    this.name = "ApplicationSchemaError";
  }
}

/** Read-only precondition, freshly checked on every write request. Not a release gate. */
export type ApplicationSchemaSql = Parameters<typeof readSchemaCatalog>[0];
export async function assertApplicationWriteSchema(sql?: ApplicationSchemaSql) {
  try {
    assertMaintenanceSchema(await readSchemaCatalog(sql ?? getSqlClient()));
  } catch {
    // A connection/catalog failure can contain credentials or topology. Keep
    // those out of the error returned through server functions and HTTP routes.
    throw new ApplicationSchemaError();
  }
}
