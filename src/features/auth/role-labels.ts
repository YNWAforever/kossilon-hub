import type { AuthRole } from "./types";

/** Display labels for roles (docs/ui-language.md); the values stay English in code and data. */
export const ROLE_LABELS: Record<AuthRole, string> = {
  Admin: "管理員",
  Manager: "經理",
  Staff: "同事",
  Client: "客戶",
};

/** Falls back to the raw value so an unexpected role is still shown, and to 用戶 when absent. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "用戶";
  return ROLE_LABELS[role as AuthRole] ?? role;
}
