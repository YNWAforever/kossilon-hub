import { z } from "zod";
/** Cursor values are boundaries only. Every query re-applies its authoritative scope. */
export function tupleCursor(values: readonly string[]) {
  return JSON.stringify(values);
}
export function readTupleCursor(value: string | undefined, length: number): string[] | null {
  if (!value) return null;
  try {
    const tuple = z.array(z.string().max(512)).length(length).parse(JSON.parse(value));
    z.string().uuid().parse(tuple.at(-1));
    return tuple;
  } catch {
    throw new Error("Invalid list cursor; reset pagination explicitly.");
  }
}
export function boundedPageSize(size: number | undefined, defaultSize = 100) {
  if (size !== undefined && (!Number.isInteger(size) || size < 1 || size > 200))
    throw new Error("List page size must be1–200");
  return size ?? defaultSize;
}
