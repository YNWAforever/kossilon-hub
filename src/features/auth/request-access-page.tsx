import { ArrowLeft, Mail } from "lucide-react";

import { PRODUCT_NAME } from "@/lib/brand";

type RequestAccessLocale = "zh-HK" | "en";

const ACCESS_MAILTO =
  "mailto:willylai@fimmick.com?subject=ComSec%20OS%20%E5%B7%A5%E4%BD%9C%E7%A9%BA%E9%96%93%E9%96%8B%E9%80%9A%E7%94%B3%E8%AB%8B";

/**
 * Public request-access page. There is no self-service signup: access is granted
 * by a firm administrator through Neon Auth, so this page explains the steps and
 * opens an email with the right subject. It stores nothing and needs no session.
 */
export function RequestAccessPage({ locale }: { locale: RequestAccessLocale }) {
  const en = locale === "en";
  const home = en ? "/en" : "/";

  const steps = en
    ? [
        "Confirm which firm and team you work with.",
        "Email the administrator from your work address.",
        "An administrator invites that address to the workspace.",
        "Open the sign-in link from the invitation email.",
      ]
    : [
        "確認你所屬的公司及團隊。",
        "使用工作電郵聯絡系統管理員。",
        "管理員會把該電郵加入工作空間。",
        "開啟邀請電郵中的登入連結。",
      ];

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto max-w-xl">
        <a
          className="inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
          href={home}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {en ? "Back to ComSec OS" : "返回 ComSec OS"}
        </a>

        <section className="mt-8 rounded-lg border border-border bg-card p-8 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            {PRODUCT_NAME}
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold">
            {en ? "Request workspace access" : "申請工作空間開通"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {en
              ? "ComSec OS is an invite-only workspace for authorised staff and clients. Access is granted by a firm administrator; there is no public sign-up."
              : "ComSec OS 只供已獲授權的同事及客戶使用，開通由公司管理員處理，並不提供公開註冊。"}
          </p>

          <ol className="mt-6 space-y-3 text-sm leading-6">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <a
            className="mt-8 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            href={ACCESS_MAILTO}
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            {en ? "Email the administrator" : "電郵公司管理員"}
          </a>

          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {en
              ? "The address is used only to reply about this request. Do not include client documents or passwords."
              : "此地址只用於回覆你的開通查詢；請勿附上客戶文件或密碼。"}
          </p>
        </section>
      </div>
    </main>
  );
}
