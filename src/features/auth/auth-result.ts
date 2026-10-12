import type { AuthSession } from "./session";
export type AuthResolution =
  | { kind: "authenticated"; session: AuthSession }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "transient_error"; supportId: string }
  | { kind: "callback_error"; reason: "expired" | "used" | "invalid" };
export type AuthFailure = Exclude<AuthResolution, { kind: "authenticated" }>;

export function classifyAuthError(error: unknown): AuthFailure {
  const value = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const status = value.status ?? value.statusCode;
  const message = error instanceof Error ? error.message : "";
  if (status === 401 || message.startsWith("Unauthorized:")) return { kind: "unauthenticated" };
  if (status === 403 || message.startsWith("Forbidden:")) return { kind: "forbidden" };
  // Installed Better Auth maps a consumed/missing token to INVALID_TOKEN. It does
  // not distinguish expired from already used, so neither cause is fabricated.
  if (value.code === "INVALID_TOKEN") return { kind: "callback_error", reason: "invalid" };
  return { kind: "transient_error", supportId: `auth-${crypto.randomUUID()}` };
}

export function authResolutionMessage(resolution: AuthFailure): string {
  if (resolution.kind === "unauthenticated") return "請登入以繼續。";
  if (resolution.kind === "forbidden") return "此帳戶未有工作區權限。請聯絡 Admin 核對身份及權限。";
  if (resolution.kind === "callback_error") return "登入連結無效或已失效。請重新申請一次連結。";
  return `暫時未能驗證身份，請重試。支援編號：${resolution.supportId}`;
}
export class AuthResolutionError extends Error {
  constructor(public readonly resolution: AuthFailure) {
    super(authResolutionMessage(resolution));
    this.name = "AuthResolutionError";
  }
}
