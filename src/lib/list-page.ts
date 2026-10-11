import { z } from "zod";

export type ListPage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
  observedAt: string;
};
export const listPageSize = z.number().int().min(1).max(50).default(50);

/** A cursor is a boundary, never authority. The query reapplies scope on every page. */
export function encodeListCursor(key: string, values: readonly string[]): string {
  return btoa(JSON.stringify({ v: 1, key: encodeURIComponent(key), values }));
}
export function decodeListCursor(
  cursor: string | undefined,
  key: string,
  length: number,
): string[] | null {
  if (!cursor) return null;
  try {
    const parsed = z
      .object({
        v: z.literal(1),
        key: z.string(),
        values: z.array(z.string().max(512)).length(length),
      })
      .strict()
      .parse(JSON.parse(atob(z.string().max(8192).parse(cursor))));
    if (parsed.key !== encodeURIComponent(key)) throw Error("Changed query");
    return parsed.values;
  } catch {
    throw Error("Invalid or changed list cursor; return to the first page.");
  }
}
export function literalContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
