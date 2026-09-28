import { z } from "zod";

/** Database key syntax only. Existence, tenant membership and role stay server-side. */
export const entityIdSchema = z
  .string()
  .length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .refine((value) => value.replaceAll("-", "").toLowerCase() !== "0".repeat(32), {
    message: "Entity ID cannot be nil.",
  })
  .transform((value) => value.toLowerCase());

export function parseEntityId(value: unknown): string | undefined {
  const result = entityIdSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function isEntityId(value: unknown): value is string {
  return entityIdSchema.safeParse(value).success;
}
