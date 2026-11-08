import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
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
  const [showPassword, setShowPassword] = useState(false);
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

  function currentRedirectTarget(): string | undefined {
    // The email/social callback opens a new tab where sessionStorage is empty;
    // carry the target through the callback URL so a deep link survives it.
    const raw = new URLSearchParams(window.location.search).get("redirect");
    const safe = getSafeRedirectPath(raw);
    return raw && safe === raw ? raw : peekRedirectPath();
  }

  function changeMode(nextMode: LoginMode) {
    if (nextMode === "magic-link" && !magicLinkEnabled) return;

    setMode(nextMode);
    setError(null);
    setSuccess(null);
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    const redirectTarget = currentRedirectTarget();

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
      const result = await loginWithGoogle(currentRedirectTarget());
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

  const year = new Date().getFullYear();

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      {/* Product side — desktop only; the form never competes with it below lg. */}
      <section className="relative hidden min-h-screen flex-1 flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-28 -top-28 h-96 w-96 rounded-full bg-primary-foreground/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-primary-foreground/5 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-foreground text-primary shadow-sm">
            <span className="font-display text-base font-bold">C</span>
          </div>
          <div>
            <div className="font-display text-lg font-semibold">{PRODUCT_NAME}</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-primary-foreground/70">
              {t("Company Secretarial Operations", PRODUCT_TAGLINE_ZH)}
            </div>
          </div>
        </div>

        <div className="relative max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary-foreground/60">
            {t("Workspace for company secretarial teams", "公司秘書團隊工作空間")}
          </p>
          <p className="mt-4 font-display text-4xl font-semibold leading-tight">
            {t(
              "Handle filings, client evidence, reminders and team operations securely.",
              "安全處理申報遞交、客戶證明文件、提醒及團隊運作。",
            )}
          </p>
          <p className="mt-4 max-w-md text-sm leading-6 text-primary-foreground/75">
            {t(
              "Coordinate annual returns, WhatsApp enquiries, document chasing and approvals in one workspace.",
              "在同一系統統籌周年申報、WhatsApp 查詢、文件追收及審批。",
            )}
          </p>
        </div>

        <div className="relative space-y-3 text-sm text-primary-foreground/85">
          {[
            {
              icon: ShieldCheck,
              label: t("Role-aware access with an audit trail", "按角色授權並保留操作紀錄"),
            },
            {
              icon: Mail,
              label: t(
                "Sign in with email, magic link or Google",
                "以電郵、登入連結或 Google 登入",
              ),
            },
            {
              icon: Building2,
              label: t(
                "Companies, documents and filings in one place",
                "公司、文件與申報集中在同一處",
              ),
            },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-foreground/10">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>{label}</span>
            </div>
          ))}
        </div>

        <p className="relative text-[11px] text-primary-foreground/50">
          © {year} {PRODUCT_NAME}
        </p>
      </section>

      {/* Sign-in side. */}
      <section className="flex min-h-screen w-full items-center justify-center px-5 py-10 sm:px-8 lg:w-[520px] lg:shrink-0">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="font-display text-base font-bold">C</span>
            </div>
            <div>
              <div className="font-display text-lg font-semibold">{PRODUCT_NAME}</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {t("Company Secretarial Operations", PRODUCT_TAGLINE_ZH)}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <div>
              <StatusPill tone="blue">{t("Secure access", "安全登入")}</StatusPill>
              <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
                {t("Sign in to your workspace", "登入工作空間")}
              </h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t(
                  "Use the email your firm invited, or continue with Google.",
                  "使用公司邀請的電郵，或以 Google 帳戶登入。",
                )}
              </p>
            </div>

            {denied && (
              <div
                className="mt-5 flex items-start gap-2 rounded-lg border border-status-red/30 bg-status-red-soft px-3 py-2.5 text-xs leading-5 text-status-red-text"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {t(
                    "This account is not authorised to use " +
                      PRODUCT_NAME +
                      ". Ask an administrator for access, or sign in with another account below.",
                    "此帳戶未獲授權使用 " +
                      PRODUCT_NAME +
                      "。請聯絡管理員開通權限，或於下方改用其他帳戶登入。",
                  )}
                </span>
              </div>
            )}

            {googleEnabled && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void submitGoogleLogin()}
                  disabled={!isHydrated || googleSubmitting}
                  className="mt-6 h-11 w-full gap-2.5 text-sm"
                >
                  {googleSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <GoogleMark className="h-4 w-4" />
                  )}
                  {t("Continue with Google", "以 Google 帳戶登入")}
                </Button>
                <div className="my-5 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {t("or use email", "或使用電郵")}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            {magicLinkEnabled && (
              <div
                className={googleEnabled ? "" : "mt-6"}
                role="group"
                aria-label={t("Sign-in method", "登入方式")}
              >
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/50 p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={mode === "password"}
                    onClick={() => changeMode("password")}
                    disabled={isSubmitting || !isHydrated}
                    className={
                      mode === "password"
                        ? "h-9 bg-background text-foreground shadow-sm"
                        : "h-9 text-muted-foreground"
                    }
                  >
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("Password", "密碼")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={mode === "magic-link"}
                    onClick={() => changeMode("magic-link")}
                    disabled={isSubmitting || !isHydrated}
                    className={
                      mode === "magic-link"
                        ? "h-9 bg-background text-foreground shadow-sm"
                        : "h-9 text-muted-foreground"
                    }
                  >
                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("Magic link", "電郵登入連結")}
                  </Button>
                </div>
              </div>
            )}

            <form onSubmit={submitLogin} className="mt-5 space-y-4" aria-busy={isSubmitting}>
              <div>
                <label htmlFor="login-email" className="text-xs font-medium text-muted-foreground">
                  {t("Email", "電郵")}
                </label>
                <Input
                  id="login-email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError(null);
                    setSuccess(null);
                  }}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  className="mt-1.5 w-full"
                />
              </div>

              {mode === "password" && (
                <div>
                  <label
                    htmlFor="login-password"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("Password", "密碼")}
                  </label>
                  <div className="relative mt-1.5">
                    <Input
                      id="login-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      className="w-full pr-11"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={
                        showPassword
                          ? t("Hide password", "隱藏密碼")
                          : t("Show password", "顯示密碼")
                      }
                      aria-pressed={showPassword}
                      tabIndex={0}
                      className="absolute right-0.5 top-1/2 h-9 w-9 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                  <a
                    href={locale === "en" ? "/en/request-access" : "/request-access"}
                    className="mt-2 inline-block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {t(
                      "Forgot your password? Contact your administrator.",
                      "忘記密碼？請聯絡公司管理員。",
                    )}
                  </a>
                </div>
              )}

              {(error || (!denied && (authIssue?.message || callbackError))) && (
                <div
                  className="flex items-start gap-2 rounded-lg border border-status-red/30 bg-status-red-soft px-3 py-2.5 text-xs leading-5 text-status-red-text"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{error || authIssue?.message || callbackError}</span>
                </div>
              )}

              {success && (
                <div
                  className="flex items-start gap-2 rounded-lg border border-status-green/30 bg-status-green-soft px-3 py-2.5 text-xs leading-5 text-status-green-text"
                  role="status"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{success}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                disabled={!isHydrated || isSubmitting}
                className="h-11 w-full"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : mode === "password" ? (
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Mail className="h-4 w-4" aria-hidden="true" />
                )}
                {mode === "password"
                  ? t("Sign in", "登入")
                  : t("Email me a magic link", "以電郵傳送登入連結")}
              </Button>
            </form>

            {authIssue?.kind === "service" && (
              <Button
                className="mt-3 w-full"
                variant="outline"
                disabled={!isHydrated || isSubmitting}
                onClick={() => void retryLoginSession()}
              >
                {t("Retry sign-in check", "重試登入狀態")}
              </Button>
            )}

            {!isDemoAuthEnabled() && (
              <div className="mt-6 border-t border-border pt-5 text-center text-xs leading-5 text-muted-foreground">
                {t("Access is invite-only.", "只限受邀用戶使用。")}{" "}
                <a
                  href={locale === "en" ? "/en/request-access" : "/request-access"}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("Request access", "申請邀請")}
                </a>
              </div>
            )}

            {demoUsers.length > 0 && (
              <div className="mt-6 border-t border-border pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("Demo identities", "示範身份")}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                      {t(
                        "Pick any identity to enter the read-only demo.",
                        "選擇任何身份即可進入示範，資料為唯讀。",
                      )}
                    </p>
                  </div>
                  <Building2
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>

                <div className="mt-3 space-y-2">
                  {demoUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => submitDemoLogin(user.id)}
                      disabled={!isHydrated}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
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

                      <span className="flex shrink-0 items-center gap-1.5">
                        <UserRound
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {roleLabel(user.role)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-[11px] leading-5 text-muted-foreground">
            {t(
              "Sign-in is limited to authorised workspace members.",
              "登入只限已獲授權的工作空間成員使用。",
            )}
          </p>
        </div>
      </section>
    </main>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.39 3.62v3.01h3.87c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.87-3.01c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.72-4.95H1.29v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27a7.2 7.2 0 0 1 0-4.54V6.62H1.29a12 12 0 0 0 0 10.76l3.99-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44A11.96 11.96 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.99 3.11C6.22 6.89 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}
