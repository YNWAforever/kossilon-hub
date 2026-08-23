export type ServiceSubscriptionWriteField = "serviceType";

/** A database constraint violation translated into a message for a specific form field. */
export class ServiceSubscriptionWriteError extends Error {
  readonly field: ServiceSubscriptionWriteField;

  constructor(field: ServiceSubscriptionWriteField, message: string) {
    super(message);
    this.name = "ServiceSubscriptionWriteError";
    this.field = field;
  }
}

const CONSTRAINT_FIELDS: Record<string, { field: ServiceSubscriptionWriteField; message: string }> =
  {
    service_subscriptions_one_per_type: {
      field: "serviceType",
      message: "This company already has an active subscription for that service.",
    },
  };

const HANDLED_CODES = new Set(["23505", "23514"]);

export function toServiceSubscriptionWriteError(
  error: unknown,
): ServiceSubscriptionWriteError | null {
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

  return new ServiceSubscriptionWriteError(mapping.field, mapping.message);
}

/** Rethrows a recognised constraint violation, otherwise rethrows as-is. */
export function rethrowServiceSubscriptionWriteError(error: unknown): never {
  const mapped = toServiceSubscriptionWriteError(error);

  if (mapped) {
    throw mapped;
  }

  throw error;
}
