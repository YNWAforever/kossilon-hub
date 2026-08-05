export type ClientWriteField = "crNumber" | "brNumber" | "contact" | "isPrimary";

/** A database constraint violation translated into a message for a specific form field. */
export class ClientWriteError extends Error {
  readonly field: ClientWriteField;

  constructor(field: ClientWriteField, message: string) {
    super(message);
    this.name = "ClientWriteError";
    this.field = field;
  }
}

const CONSTRAINT_FIELDS: Record<string, { field: ClientWriteField; message: string }> = {
  companies_cr_number_key: {
    field: "crNumber",
    message: "A company with this CR number already exists.",
  },
  companies_br_number_key: {
    field: "brNumber",
    message: "A company with this BR number already exists.",
  },
  company_contacts_reachable_check: {
    field: "contact",
    message: "Provide an email or a phone number.",
  },
  company_contacts_primary_uidx: {
    field: "isPrimary",
    message: "This company already has a primary contact.",
  },
};

const HANDLED_CODES = new Set(["23505", "23514"]);

export function toClientWriteError(error: unknown): ClientWriteError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const { code, constraint_name: constraintName } = error as Error & {
    code?: string;
    constraint_name?: string;
  };

  if (!code || !constraintName || !HANDLED_CODES.has(code)) {
    return null;
  }

  const mapping = CONSTRAINT_FIELDS[constraintName];

  if (!mapping) {
    return null;
  }

  return new ClientWriteError(mapping.field, mapping.message);
}

/** Rethrows a recognised constraint violation as a ClientWriteError, otherwise rethrows as-is. */
export function rethrowClientWriteError(error: unknown): never {
  const mapped = toClientWriteError(error);

  if (mapped) {
    throw mapped;
  }

  throw error;
}
