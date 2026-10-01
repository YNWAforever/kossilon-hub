import type { AuthRole } from "@/features/auth/types";

/** Values of companies.data_origin; unknown is a read state, never a write value. */
export type CompanyDataOrigin = "client" | "fixture" | "historical";

export function dataOriginLabel(origin: CompanyDataOrigin | null | undefined): string {
  if (origin === "client") return "客戶資料";
  if (origin === "fixture") return "測試資料";
  if (origin === "historical") return "歷史資料（不外發）";
  return "來源待核對";
}

export function originFilterForActor(
  actor: { role: AuthRole; active: boolean },
  includeFixtures = false,
) {
  if (!actor.active) throw new Error("Forbidden: inactive actor");
  if (includeFixtures && actor.role !== "Admin")
    throw new Error("Forbidden: only Admin may include fixtures in diagnostics");
  return { includeFixtures };
}
