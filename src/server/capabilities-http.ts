import { authMethodsFor, type AuthMethods } from "../features/auth/auth-methods";
import { resolveSecurityHeaderMode } from "./security-headers";

export type SecurityPosture = {
  cspMode: "off" | "report-only" | "enforce";
  /**
   * Which sign-in methods the build exposes (VITE_AUTH_METHODS, defaulting to
   * password + magic link + Google). This is the same resolver the login page
   * uses, so an administrator can see the deployed choice rather than infer it.
   */
  authMethods: AuthMethods;
};

export type CapabilityStatus = {
  id:
    | "firm"
    | "database"
    | "auth"
    | "documents"
    | "email"
    | "whatsapp"
    | "document-scanner"
    | "scheduler";
  label: string;
  configured: boolean;
  /** Binding NAMES that are missing, never their values. */
  missing: readonly string[];
};

type Env = Record<string, string | undefined>;

function present(env: Env, name: string): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function status(
  id: CapabilityStatus["id"],
  label: string,
  env: Env,
  required: readonly string[],
): CapabilityStatus {
  const missing = required.filter((name) => !present(env, name));
  return { id, label, configured: missing.length === 0, missing };
}

/**
 * What this deployment is actually provisioned for, by binding NAME only.
 *
 * This is the honest counterpart to `/operations`: anything `false` here must not
 * look enabled in the UI. No value, host or credential is returned, and the
 * endpoint makes no outbound probe — "configured" means the binding exists, not
 * that the provider is reachable.
 */
export function runtimeCapabilities(env: Env): {
  capabilities: CapabilityStatus[];
  security: SecurityPosture;
} {
  const documents =
    present(env, "DOCUMENTS_BUCKET") ||
    (present(env, "R2_ACCOUNT_ID") &&
      present(env, "R2_ACCESS_KEY_ID") &&
      present(env, "R2_SECRET_ACCESS_KEY") &&
      present(env, "R2_BUCKET_NAME"));

  const emailConfigured =
    present(env, "RESEND_API_KEY") && (present(env, "EMAIL_FROM") || present(env, "RESEND_FROM"));
  const emailMissing: string[] = [];
  if (!present(env, "RESEND_API_KEY")) emailMissing.push("RESEND_API_KEY");
  if (!present(env, "EMAIL_FROM") && !present(env, "RESEND_FROM")) {
    emailMissing.push("EMAIL_FROM|RESEND_FROM");
  }

  const schedulerConfigured =
    env.MAINTENANCE_SCHEDULER_OWNER === "vercel" && present(env, "CRON_SECRET");
  const schedulerMissing: string[] = [];
  if (env.MAINTENANCE_SCHEDULER_OWNER !== "vercel") {
    schedulerMissing.push("MAINTENANCE_SCHEDULER_OWNER=vercel");
  }
  if (!present(env, "CRON_SECRET")) schedulerMissing.push("CRON_SECRET");

  return {
    security: {
      cspMode: resolveSecurityHeaderMode(env.SECURITY_HEADERS),
      authMethods: authMethodsFor(env.VITE_AUTH_METHODS),
    },
    capabilities: [
      status("firm", "Firm identity", env, ["FIRM_ID"]),
      status("database", "Database", env, ["DATABASE_URL"]),
      status("auth", "Authentication", env, ["NEON_AUTH_URL", "NEON_AUTH_COOKIE_SECRET"]),
      {
        id: "documents",
        label: "Document storage",
        configured: documents,
        missing: documents
          ? []
          : [
              "DOCUMENTS_BUCKET or R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME",
            ],
      },
      {
        id: "email",
        label: "Email delivery",
        configured: emailConfigured,
        missing: emailMissing,
      },
      status("whatsapp", "WhatsApp", env, [
        "WOZTELL_API_BASE_URL",
        "WOZTELL_ACCESS_TOKEN",
        "WOZTELL_CHANNEL_ID",
        "WOZTELL_WEBHOOK_SECRET",
      ]),
      status("document-scanner", "Document scanner", env, [
        "DOCUMENT_SCANNER_URL",
        "DOCUMENT_SCANNER_API_KEY",
      ]),
      {
        id: "scheduler",
        label: "Maintenance scheduler",
        configured: schedulerConfigured,
        missing: schedulerMissing,
      },
    ],
  };
}
