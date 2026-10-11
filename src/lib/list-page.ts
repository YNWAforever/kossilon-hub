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
  const bytes = new TextEncoder().encode(
    JSON.stringify({ v: 1, key: encodeURIComponent(key), values }),
  );
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
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
      .parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(atob(z.string().max(8192).parse(cursor)), (character) =>
              character.charCodeAt(0),
            ),
          ),
        ),
      );
    if (parsed.key !== encodeURIComponent(key)) throw Error("Changed query");
    return parsed.values;
  } catch {
    throw Error("Invalid list cursor or changed query; return to the first page.");
  }
}
export function literalContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
export function decodeTimestampCursor(cursor: string | undefined, key: string): string[] | null {
  const values = decodeListCursor(cursor, key, 2);
  if (
    values &&
    (!z.string().uuid().safeParse(values[1]).success ||
      !Number.isFinite(
        new Date(values[0].replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).getTime(),
      ))
  )
    throw Error("Invalid list cursor; return to the first page.");
  return values;
}
