import {
  EXPECTED_MIGRATIONS,
  schemaHealthOf,
  type SchemaFact,
  type SchemaLedger,
} from "@/features/operations/schema-health";

// These are the physical facts readSchemaCatalog currently verifies. This is
// deliberately a scoped precondition, not proof of every table or a release gate.
const REQUIRED_FACTS = [
  "notification_outbox.dispatch_started_attempt",
  "notification_outbox_dispatch_marker_idx",
] as const;

export class MaintenanceSchemaError extends Error {
  constructor() {
    super("Maintenance schema incompatible or unavailable; review Operations before retrying.");
    this.name = "MaintenanceSchemaError";
  }
}

export function assertMaintenanceSchema(input: {
  ledger: SchemaLedger;
  facts: readonly SchemaFact[];
}) {
  const health = schemaHealthOf({ expected: EXPECTED_MIGRATIONS, ledger: input.ledger });
  if (
    health.state !== "current" ||
    REQUIRED_FACTS.some(
      (key) =>
        input.facts.filter((fact) => fact.key === key).length !== 1 ||
        input.facts.find((fact) => fact.key === key)?.present !== true,
    ) ||
    input.facts.some((fact) => fact.present !== true)
  ) {
    throw new MaintenanceSchemaError();
  }
}
