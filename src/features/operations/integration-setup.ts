export type IntegrationSetupId =
  | "firm"
  | "database"
  | "auth"
  | "documents"
  | "email"
  | "whatsapp"
  | "document-scanner"
  | "scheduler";

export type IntegrationSetup = {
  id: IntegrationSetupId;
  label: string;
  /** Binding names only — this catalog never carries values. */
  required: readonly string[];
  /** Subset that providers treat as secrets; those must stay in Vercel env. */
  secrets: readonly string[];
  action: string;
};

/**
 * The single source of truth for what a firm administrator must provision and
 * where. Rendering is honest: a row is "配置" only when `/api/capabilities`
 * reports every required binding present.
 */
export const INTEGRATION_SETUP: readonly IntegrationSetup[] = [
  {
    id: "firm",
    label: "公司身份（FIRM_ID）",
    required: ["FIRM_ID"],
    secrets: [],
    action:
      "由負責人確認公司 slug，並在 Vercel → Settings → Environment Variables 設定 FIRM_ID 後重新部署。",
  },
  {
    id: "database",
    label: "資料庫（Neon）",
    required: ["DATABASE_URL"],
    secrets: ["DATABASE_URL"],
    action: "由 Vercel 的 Neon 整合或負責人提供 DATABASE_URL（production 分支）。",
  },
  {
    id: "auth",
    label: "登入（Neon Auth）",
    required: ["NEON_AUTH_URL", "NEON_AUTH_COOKIE_SECRET"],
    secrets: ["NEON_AUTH_COOKIE_SECRET"],
    action: "由 Vercel 的 Neon Auth 整合提供；cookie secret 由負責人設定。",
  },
  {
    id: "documents",
    label: "文件儲存（R2）",
    required: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"],
    secrets: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
    action: "由負責人在 Cloudflare R2 建立 bucket/金鑰，於 Vercel 設定四個 R2_* 變數。",
  },
  {
    id: "email",
    label: "電郵（Resend）",
    required: ["RESEND_API_KEY", "EMAIL_FROM|RESEND_FROM"],
    secrets: ["RESEND_API_KEY"],
    action: "先批核寄件地址／網域，再在 Vercel 設定 RESEND_API_KEY 與 EMAIL_FROM。",
  },
  {
    id: "whatsapp",
    label: "WhatsApp（WOZTELL）",
    required: [
      "WOZTELL_API_BASE_URL",
      "WOZTELL_ACCESS_TOKEN",
      "WOZTELL_CHANNEL_ID",
      "WOZTELL_WEBHOOK_SECRET",
    ],
    secrets: ["WOZTELL_ACCESS_TOKEN", "WOZTELL_WEBHOOK_SECRET"],
    action: "批核 WOZTELL 帳戶及 zh_HK 模板後，設定四個 WOZTELL_* 變數；未設定時導覽隱藏。",
  },
  {
    id: "document-scanner",
    label: "文件掃描",
    required: ["DOCUMENT_SCANNER_URL", "DOCUMENT_SCANNER_API_KEY"],
    secrets: ["DOCUMENT_SCANNER_API_KEY"],
    action:
      "選擇掃描供應商後設定兩個 DOCUMENT_SCANNER_* 變數；未設定時文件維持隔離，不會被標記為安全。",
  },
  {
    id: "scheduler",
    label: "維護排程",
    required: ["MAINTENANCE_SCHEDULER_OWNER=vercel", "CRON_SECRET"],
    secrets: ["CRON_SECRET"],
    action: "保持 MAINTENANCE_SCHEDULER_OWNER=vercel 與 Vercel Cron；CRON_SECRET 由負責人設定。",
  },
] as const;

export function setupRows(
  capabilities: readonly {
    id?: string;
    configured?: boolean;
    missing?: readonly string[];
  }[],
): Array<IntegrationSetup & { configured: boolean; missing: readonly string[] }> {
  const byId = new Map(
    capabilities.flatMap((capability) =>
      capability.id ? [[capability.id, capability] as const] : [],
    ),
  );
  return INTEGRATION_SETUP.map((setup) => {
    const capability = byId.get(setup.id);
    return {
      ...setup,
      configured: capability?.configured === true,
      missing: capability?.missing ?? setup.required,
    };
  });
}
