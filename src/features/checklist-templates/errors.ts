export type ChecklistTemplateWriteField = "name";

/** A database constraint violation translated into a message for a specific form field. */
export class ChecklistTemplateWriteError extends Error {
  readonly field: ChecklistTemplateWriteField;

  constructor(field: ChecklistTemplateWriteField, message: string) {
    super(message);
    this.name = "ChecklistTemplateWriteError";
    this.field = field;
  }
}

const CONSTRAINT_FIELDS: Record<string, { field: ChecklistTemplateWriteField; message: string }> = {
  checklist_templates_name_key: {
    field: "name",
    message: "A checklist template with this name already exists.",
  },
};

const HANDLED_CODES = new Set(["23505"]);

export function toChecklistTemplateWriteError(error: unknown): ChecklistTemplateWriteError | null {
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

  return new ChecklistTemplateWriteError(mapping.field, mapping.message);
}

/** Rethrows a recognised constraint violation as a ChecklistTemplateWriteError, otherwise rethrows as-is. */
export function rethrowChecklistTemplateWriteError(error: unknown): never {
  const mapped = toChecklistTemplateWriteError(error);

  if (mapped) {
    throw mapped;
  }

  throw error;
}
