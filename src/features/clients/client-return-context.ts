import { defaultStringifySearch } from "@tanstack/react-router";
import { parseEntityId } from "@/lib/entity-id";
import { clientDetailSearch } from "./register-view-state";

/** Exact client route, with the validated register return nested once. UUID
 * shape is checked here; company existence and read access remain server checks.
 */
export function clientCaseReturnPath(companyId: unknown, registerReturnTo?: unknown): string {
  if (typeof companyId !== "string" || parseEntityId(companyId) === null) return "/clients";
  return `/clients/${companyId}${defaultStringifySearch(clientDetailSearch({ returnTo: registerReturnTo }))}`;
}
