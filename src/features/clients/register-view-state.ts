import { defaultStringifySearch } from "@tanstack/react-router";
import { z } from "zod";
import { caseReturnPath } from "@/features/annual-return/daily-view-state";

const clientCursor = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      // Same company-name/UUID boundary as the existing client page read.
      z.tuple([z.string().max(512), z.string().uuid()]).parse(JSON.parse(value));
      return true;
    } catch {
      return false;
    }
  }, "Invalid client cursor; return to the first page.");
const searchSchema = z.object({
  q: z.string().max(200).default(""),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  team: z.union([z.literal("all"), z.string().uuid()]).default("all"),
  includeFixtures: z.preprocess(
    (value) => (value === "true" ? true : value === "false" ? false : value),
    z.boolean().default(false),
  ),
  cursor: clientCursor.optional(),
});
export type ClientRegisterSearch = z.infer<typeof searchSchema>;

/** Invalid scalar or repeated values reject navigation instead of widening filters. */
export function clientRegisterSearch(input: Record<string, unknown>): ClientRegisterSearch {
  return searchSchema.parse(input);
}
export function clientRegisterReturnPath(search: ClientRegisterSearch): string {
  // The router's serializer preserves JSON-shaped strings, including tuple
  // cursors and numeric company identifiers, when its parser reads them again.
  return `/clients${defaultStringifySearch(clientRegisterSearch(search))}`;
}
export function clientDetailSearch(input: Record<string, unknown>) {
  const safe = caseReturnPath(input.returnTo);
  return {
    returnTo: typeof input.returnTo === "string" && safe === input.returnTo ? safe : "/clients",
  };
}
