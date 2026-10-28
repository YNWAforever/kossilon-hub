import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useNavigate,
  useRouter,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { errorDetails } from "../lib/error-details";
import { AppSidebar } from "@/components/app-sidebar";
import { AppMobileNav } from "@/components/app-mobile-nav";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  AuthProvider,
  AuthSessionBoundary,
  classifyAuthFailure,
  readAuthWithTimeout,
  useAuth,
} from "@/features/auth/auth-context-neon";
import { getAuthenticatedActor } from "@/features/auth/neon-auth-rpc";
import type { DataMode } from "@/features/runtime/data-mode";
import {
  getSafeRedirectPath,
  isClientRoute,
  isMarketingRoute,
  isPublicRoute,
  rememberRedirectPath,
} from "@/features/auth/route-guard";
import type { AuthenticatedActor } from "@/features/auth/types";
import { ensureActorQueryScope } from "@/features/auth/query-scope";

/**
 * `actor` is resolved in beforeLoad and handed to every route. The call was
 * already being made to gate the route — its result was simply discarded, which
 * is why no screen could tell a Client sign-in from a staff one.
 */
type RouterContext = {
  queryClient: QueryClient;
  dataMode: DataMode;
  actor: AuthenticatedActor | null;
};

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">找不到頁面</h2>
        <p className="mt-2 text-sm text-muted-foreground">你要找的頁面不存在或已移除。</p>
        <div className="mt-6">
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            返回首頁
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [copied, setCopied] = useState(false);
  const details = errorDetails(error, pathname);
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-xl font-semibold text-foreground">發生錯誤</h1>
        <p className="mt-2 text-sm text-muted-foreground">請重新整理頁面再試。</p>

        <p className="mt-4 break-words rounded-md bg-muted px-4 py-3 text-left text-sm text-foreground">
          {message || "沒有提供錯誤訊息。"}
        </p>

        <details className="mt-3 text-left">
          <summary className="cursor-pointer text-xs text-muted-foreground">技術詳情</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-left text-xs leading-relaxed text-muted-foreground">
            {details}
          </pre>
        </details>

        <div className="mt-6 flex justify-center gap-2">
          <Button
            variant="primary"
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            重試
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(details).then(() => setCopied(true));
            }}
          >
            {copied ? "已複製" : "複製詳情"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Public documents render without JavaScript. Keep the existing client-only
  // staff/auth lifecycle for every other route.
  ssr: ({ location }) => (isMarketingRoute(location.pathname) ? true : undefined),
  beforeLoad: async ({ context, location }) => {
    if (isPublicRoute(location.pathname)) {
      await ensureActorQueryScope(context.queryClient, null);
      return { actor: null };
    }

    const { dataMode } = context;
    if (dataMode !== "demo") {
      let actor: AuthenticatedActor;
      try {
        actor = await readAuthWithTimeout(() => getAuthenticatedActor());
      } catch (error) {
        const issue = classifyAuthFailure(error);
        if (issue.kind === "service") throw new Error(issue.message);
        await ensureActorQueryScope(context.queryClient, null);
        // A Forbidden account is not "not signed in" — sending it through the
        // same redirect=... path would bounce it back here after every future
        // sign-in, identically and silently, since the sign-in step itself keeps
        // succeeding. Only the authorisation check fails.
        const redirectPath = getSafeRedirectPath(location.href);
        rememberRedirectPath(redirectPath);
        throw redirect({
          href: `/login?${issue.kind === "unauthorized" ? "denied=1&" : ""}redirect=${encodeURIComponent(redirectPath)}`,
          replace: true,
        });
      }

      await ensureActorQueryScope(context.queryClient, actor);
      // Every screen except these resolves a staff actor, so a Client signing in
      // and landing on the dashboard hit Forbidden on every query it makes. They
      // get the portal instead — which is the only thing built for them.
      if (actor.role === "Client" && !isClientRoute(location.pathname)) {
        throw redirect({ href: "/portal", replace: true });
      }

      return { actor };
    }

    return { actor: null };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Kossilon CoSec OS — 公司秘書營運平台" },
      {
        name: "description",
        content:
          "香港公司秘書行的內部營運平台：WhatsApp 查詢、周年申報流程、文件追收、付款提醒及團隊分配。",
      },
      { property: "og:title", content: "Kossilon CoSec OS" },
      {
        property: "og:description",
        content: "專為香港公司秘書行而設的營運平台。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <html lang={pathname === "/en" ? "en" : "zh-HK"}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient, actor } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // A public brochure never needs session bootstrap or staff data. It remains
  // usable when auth is unavailable, including for already signed-in visitors.
  if (isMarketingRoute(pathname)) return <Outlet />;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthSessionBoundary queryClient={queryClient}>
        <AuthProvider key={JSON.stringify(actor)} queryClient={queryClient}>
          {isPublicRoute(pathname) ? <Outlet /> : <ProtectedAppShell />}
          <Toaster />
        </AuthProvider>
      </AuthSessionBoundary>
    </QueryClientProvider>
  );
}

function ProtectedAppShell() {
  const { session, isHydrated, authIssue, retrySession } = useAuth();
  const navigate = useNavigate();
  const redirectPath = useRouterState({
    select: (state) => `${state.location.pathname}${state.location.searchStr}`,
  });

  useEffect(() => {
    if (!isHydrated || session) return;
    if (authIssue?.kind === "service") return;

    const safeReturn = getSafeRedirectPath(redirectPath);
    rememberRedirectPath(safeReturn);
    void navigate({
      href: `/login?${authIssue?.kind === "unauthorized" ? "denied=1&" : ""}redirect=${encodeURIComponent(safeReturn)}`,
      replace: true,
    });
  }, [authIssue, isHydrated, navigate, redirectPath, session]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="font-display text-sm font-bold">K</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">正在核對登入狀態…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    if (authIssue?.kind === "service") {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
          <p role="alert">{authIssue.message}</p>
          <Button onClick={() => void retrySession()}>重試登入狀態</Button>
        </main>
      );
    }
    return null;
  }

  return (
    <div
      key={JSON.stringify([session.id, session.role, session.team])}
      className="flex min-h-screen w-full bg-background"
    >
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppMobileNav />
        <Outlet />
      </div>
    </div>
  );
}
