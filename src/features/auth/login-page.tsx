import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Building2,
  Chrome,
  KeyRound,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useAuth } from "@/features/auth/auth-context-neon";
import { authMethodsFor } from "@/features/auth/auth-methods";
import { roleLabel } from "@/features/auth/role-labels";
import {
  consumeRedirectPath,
  getSafeRedirectPath,
  isDemoAuthEnabled,
  peekRedirectPath,
  rememberRedirectPath,
} from "@/features/auth/route-guard";
import { PRODUCT_NAME, PRODUCT_TAGLINE_ZH } from "@/lib/brand";

type LoginMode = "password" | "magic-link";

export function LoginPage({ locale = "zh-HK" }: { locale?: "zh-HK" | "en" } = {}) {
  const navigate = useNavigate();
  const t = (en: string, zh: string) => (locale === "en" ? en : zh);
  const demoAuth = isDemoAuthEnabled();
  const methods = authMethodsFor(import.meta.env.VITE_AUTH_METHODS);
  const magicLinkEnabled = !demoAuth && methods.magicLink;
  const googleEnabled = !demoAuth && methods.google;
  const {
    session,
    isHydrated,
    login,
    loginWithMagicLink,
    loginWithGoogle,
    loginDemo,
    demoUsers,
    signOut,
    authIssue,
    signOutState,
    retrySession,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<LoginMode>("password");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [denied, setDenied] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  // Read the query string in an effect, not during render: the server has no
  // window, and a server/client initial-state difference is a hydration mismatch.
  const [callbackError, setCallbackError] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("error")) {
      setCallbackError(
        locale === "en"
          ? "That sign-in link is expired or invalid. Request a new one."
          : "登入連結已過期或無效，請重新要求登入連結。",
      );
    }
  }, [locale]);

  useEffect(() => {
    if (session) return;
    const redirect = new URLSearchParams(window.location.search).get("redirect");
    if (redirect && getSafeRedirectPath(redirect) === redirect) rememberRedirectPath(redirect);
  }, [session]);

  useEffect(() => {
    if (!isHydrated || !session) return;
    // The actor-keyed provider may remount while navigation is committing.
    // A departed login page must not replace the chosen destination again.
    if (window.location.pathname !== "/login") return;
    // A Forbidden rejection (the only way to reach ?denied=1) implies a session
    // that authenticates but isn't provisioned — so `session` here can be the
    // same stale, still-truthy value carried over from immediately before the
    // redirect (AuthProvider wraps both the protected shell and this route, so
    // it never remounts on that client-side navigation). Without this guard,
    // this effect would navigate away before the denied effect below ever runs.
    if (new URLSearchParams(window.location.search).get("denied") === "1") return;

    const searchRedirect = new URLSearchParams(window.location.search).get("redirect");
    const safeSearchRedirect = getSafeRedirectPath(searchRedirect);
    // 今日工作 reads production work views only, so in the read-only demo it is an
    // empty state; demo staff start on the fixture-backed dashboard instead.
    const fallback = session.role === "Client" ? "/portal" : demoAuth ? "/dashboard" : "/today";
    const storedRedirect = consumeRedirectPath(undefined, fallback);
    const redirectPath =
      searchRedirect && safeSearchRedirect === searchRedirect ? safeSearchRedirect : storedRedirect;
    void navigate({ href: redirectPath, replace: true });
  }, [demoAuth, isHydrated, navigate, session]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("denied") !== "1") return;

    setDenied(true);
    if (signOutState === "signed-out") {
      const url = new URL(window.location.href);
      url.searchParams.delete("denied");
      history.replaceState(history.state, "", url.href);
      setDenied(false);
      return;
    }
    // Bootstrap has no real sign-out adapter. An unresolved/failed attempt must
    // wait for explicit recovery instead of automatically starting another one.
    if (!isHydrated || signOutState === "pending" || signOutState === "failed") return;
    // Clear the marker once sign-out actually completes so the redirect
    // effect's guard above stops blocking if the user then successfully signs
    // in again as a different, properly-provisioned account. Until this
    // resolves, `denied=1` staying in the URL is exactly what keeps that guard
    // correctly blocking a still-stale session. Follows the same
    // history.replaceState shape as clearSessionVerifier() in neon-auth-client.ts.
    void signOut()
      .then(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete("denied");
        history.replaceState(history.state, "", url.href);
      })
      .catch(() => {
        setError(
          locale === "en"
            ? "Could not complete sign-out. Please retry or reload the page."
            : "未能完成登出，請重試或重新整理頁面。",
        );
      });
  }, [isHydrated, locale, signOut, signOutState]);

  function changeMode(nextMode: LoginMode) {
    if (nextMode === "magic-link" && !magicLinkEnabled) return;

    setMode(nextMode);
    setError(null);
    setSuccess(null);
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    // The email opens a new tab where sessionStorage is empty; carry the target
    // through the callback URL so the deep link survives verification.
    const rawRedirect = new URLSearchParams(window.location.search).get("redirect");
    const safeRedirect = getSafeRedirectPath(rawRedirect);
    const redirectTarget =
      rawRedirect && safeRedirect === rawRedirect ? rawRedirect : peekRedirectPath();

    try {
      const result =
        mode === "magic-link" && magicLinkEnabled
          ? await loginWithMagicLink(email, redirectTarget)
          : await login(email, password);

      if (result.ok) {
        setError(null);
        setSuccess(
          mode === "magic-link"
            ? (result.message ??
                t("Check your email for the sign-in link.", "請查看電郵中的登入連結。"))
            : null,
        );
      } else {
        setError(result.error);
        setSuccess(null);
      }
    } catch {
      setError(
        t("Could not complete sign-in. Please try again.", "未能完成登入要求，請再試一次。"),
      );
      setSuccess(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitDemoLogin(userId: string) {
    const result = await loginDemo(userId);
    setError(result.ok ? null : result.error);
  }

  async function submitGoogleLogin() {
    setGoogleSubmitting(true);
    setError(null);
    try {
      const result = await loginWithGoogle();
      if (result.ok) return;
      setError(result.error);
    } catch {
      setError(
        t("Could not complete sign-in. Please try again.", "未能完成登入要求，請再試一次。"),
      );
    }
    setGoogleSubmitting(false);
    // On success the browser is already navigating to Google; no further state
    // update is meaningful before the page unloads.
  }

  async function retryLoginSession() {
    setIsSubmitting(true);
    try {
      const result = await retrySession();
      setError(result.ok ? null : result.error);
    } catch {
      setError(
        t("The sign-in service is unavailable. Please retry.", "登入服務暫時無法使用，請重試。"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      <section className="hidden min-h-screen flex-1 flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-foreground text-primary">
            <span className="font-display text-base font-bold">C</span>
          </div>
          <div>
            <div className="font-display text-lg font-semibold">{PRODUCT_NAME}</div>
            <div className="text-xs uppercase tracking-wider text-primary-foreground/70">
              {t("Company Secretarial Operations", PRODUCT_TAGLINE_ZH)}
            </div>
          </div>
        </div>

        <div className="max-w-xl">
          <h1 className="font-display text-4xl font-semibold leading-tight">
            {t(
              "Handle filings, client evidence, reminders and team operations securely.",
              "安全處理申報遞交、客戶證明文件、提醒及團隊運作。",
            )}
          </h1>
          <p className="mt-4 text-sm leading-6 text-primary-foreground/75">
            {t(
              "Coordinate annual returns, WhatsApp enquiries, document chasing and approvals in one workspace.",
              "在同一系統統籌周年申報、WhatsApp 查詢、文件追收及審批。",
            )}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs text-primary-foreground/90">
          <div className="rounded-md bg-primary-foreground/10 p-3">
            {t("Annual return workflow", "周年申報流程")}
          </div>
          <div className="rounded-md bg-primary-foreground/10 p-3">
            {t("Role-aware workspace", "按角色分配的工作區")}
          </div>
          <div className="rounded-md bg-primary-foreground/10 p-3">
            {t("Compliance visibility", "合規狀況一目了然")}
          </div>
        </div>
      </section>

      <section className="flex min-h-screen w-full items-center justify-center px-6 py-10 lg:w-[500px]">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="font-display text-base font-bold">C</span>
            </div>
            <div>
              <div className="font-display text-lg font-semibold">{PRODUCT_NAME}</div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("Company Secretarial Operations", PRODUCT_TAGLINE_ZH)}
              </div>
            </div>
          </div>

          <div>
            <StatusPill tone="blue">{t("Secure access", "安全登入")}</StatusPill>
            <h1 className="mt-4 font-display text-2xl font-semibold">
              {t("Sign in to your workspace", "登入工作空間")}
            </h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t(
                "Use your firm's workspace account to sign in.",
                "請使用貴公司的工作空間帳戶登入。",
              )}
            </p>
          </div>

          {denied && (
            <div
              className="mt-6 rounded-md border border-status-red/30 bg-status-red-soft px-3 py-2 text-xs text-status-red-text"
              role="alert"
            >
              {t(
                "This account is not authorised to use " +
                  PRODUCT_NAME +
                  ". Ask an administrator for access, or sign in with another account below.",
                "此帳戶未獲授權使用 " +
                  PRODUCT_NAME +
                  "。請聯絡管理員開通權限，或於下方改用其他帳戶登入。",
              )}
            </div>
          )}

          {magicLinkEnabled && (
            <div
              className="mt-6 grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/40 p-1"
              role="group"
              aria-label="登入方式"
            >
              <Button
                variant={mode === "password" ? "primary" : "outline"}
                size="sm"
                aria-pressed={mode === "password"}
                onClick={() => changeMode("password")}
                disabled={isSubmitting || !isHydrated}
                className="h-auto min-h-9 whitespace-normal py-2"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {t("Password", "密碼")}
              </Button>
              <Button
                variant={mode === "magic-link" ? "primary" : "outline"}
                size="sm"
                aria-pressed={mode === "magic-link"}
                onClick={() => changeMode("magic-link")}
                disabled={isSubmitting || !isHydrated}
                className="h-auto min-h-9 whitespace-normal py-2"
              >
                <Mail className="h-3.5 w-3.5" />
                {t("Magic link", "電郵登入連結")}
              </Button>
            </div>
          )}

          <form onSubmit={submitLogin} className="mt-4 space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                {t("Email", "電郵")}
              </span>
              <Input
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                  setSuccess(null);
                }}
                type="email"
                autoComplete="email"
                className="mt-1 w-full"
              />
            </label>

            {mode === "password" && (
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("Password", "密碼")}
                </span>
                <Input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  className="mt-1 w-full"
                />
              </label>
            )}

            {(error || (!denied && (authIssue?.message || callbackError))) && (
              <div
                className="flex items-start gap-2 rounded-md border border-status-red/30 bg-status-red-soft px-3 py-2 text-xs text-status-red-text"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error || authIssue?.message || callbackError}</span>
              </div>
            )}

            {success && (
              <div
                className="rounded-md border border-status-green/30 bg-status-green-soft px-3 py-2 text-xs text-status-green-text"
                role="status"
              >
                {success}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={!isHydrated || isSubmitting}
              className="w-full"
            >
              {mode === "password" ? (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  {t("Sign in", "登入")}
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  {t("Email me a magic link", "以電郵傳送登入連結")}
                </>
              )}
            </Button>
          </form>

          {authIssue?.kind === "service" && (
            <Button
              className="mt-4 w-full"
              variant="outline"
              disabled={!isHydrated || isSubmitting}
              onClick={() => void retryLoginSession()}
            >
              {t("Retry sign-in check", "重試登入狀態")}
            </Button>
          )}

          {googleEnabled && (
            <Button
              variant="outline"
              onClick={() => void submitGoogleLogin()}
              disabled={!isHydrated || googleSubmitting}
              className="mt-4 w-full"
            >
              <Chrome className="h-4 w-4" />
              {t("Continue with Google", "以 Google 帳戶登入")}
            </Button>
          )}

          {!isDemoAuthEnabled() && (
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
              {t(
                "Access is invite-only. Contact your administrator to request access.",
                "只限受邀用戶使用。如需開通，請聯絡公司管理員。",
              )}
              <a
                href="mailto:willylai@fimmick.com?subject=ComSec%20OS%20%E5%B7%A5%E4%BD%9C%E7%A9%BA%E9%96%93%E9%96%8B%E9%80%9A%E7%94%B3%E8%AB%8B"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("Request access", "申請邀請")}
              </a>
            </p>
          )}

          {demoUsers.length > 0 && (
            <div className="mt-7 border-t border-border pt-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("Demo identities", "示範身份")}
                </p>
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="mt-3 space-y-2">
                {demoUsers.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => submitDemoLogin(user.id)}
                    disabled={!isHydrated}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sand text-xs font-semibold text-white">
                        {user.initials}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{user.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {user.email}
                        </span>
                      </span>
                    </span>

                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <UserRound className="h-3.5 w-3.5" />
                      {roleLabel(user.role)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
