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
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { errorDetails } from "../lib/error-details";
import { AppSidebar } from "@/components/app-sidebar";
import { AppMobileNav } from "@/components/app-mobile-nav";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/features/auth/auth-context-neon";
import { getAuthenticatedActor } from "@/features/auth/neon-auth-rpc";
import type { DataMode } from "@/features/runtime/data-mode";
import {
  getSafeRedirectPath,
  isClientRoute,
  isForbiddenAuthError,
  isPublicRoute,
  rememberRedirectPath,
} from "@/features/auth/route-guard";
import type { AuthenticatedActor } from "@/features/auth/types";

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
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [copied, setCopied] = useState(false);
  const details = errorDetails(error, pathname);

  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try refreshing the page.</p>

        <p className="mt-4 break-words rounded-md bg-muted px-4 py-3 text-left text-sm text-foreground">
          {error.message || "No error message was provided."}
        </p>

        <details className="mt-3 text-left">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Technical details
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-left text-xs leading-relaxed text-muted-foreground">
            {details}
          </pre>
        </details>

        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(details).then(() => setCopied(true));
            }}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            type="button"
          >
            {copied ? "Copied" : "Copy details"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    if (isPublicRoute(location.pathname)) return { actor: null };

    const { dataMode } = context;
    if (dataMode !== "demo") {
      let actor: AuthenticatedActor;
      try {
        actor = await getAuthenticatedActor();
      } catch (error) {
        // A Forbidden account is not "not signed in" — sending it through the
        // same redirect=... path would bounce it back here after every future
        // sign-in, identically and silently, since the sign-in step itself keeps
        // succeeding. Only the authorisation check fails.
        if (isForbiddenAuthError(error)) {
          throw redirect({ href: "/login?denied=1", replace: true });
        }

        const redirectPath = getSafeRedirectPath(location.href);
        rememberRedirectPath(redirectPath);
        throw redirect({
          href: `/login?redirect=${encodeURIComponent(redirectPath)}`,
          replace: true,
        });
      }

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
      { title: "Kossilon CoSec OS — Company Secretary Dashboard" },
      {
        name: "description",
        content:
          "Internal SaaS dashboard for Hong Kong company secretary firms — WhatsApp enquiries, annual return workflows, document chasing, payment reminders, and team assignment.",
      },
      { property: "og:title", content: "Kossilon CoSec OS" },
      {
        property: "og:description",
        content: "Company secretary operations platform for Hong Kong firms.",
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
  return (
    <html lang="en">
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
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {isPublicRoute(pathname) ? <Outlet /> : <ProtectedAppShell />}
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function ProtectedAppShell() {
  const { session, isHydrated } = useAuth();
  const navigate = useNavigate();
  const redirectPath = useRouterState({
    select: (state) => `${state.location.pathname}${state.location.searchStr}`,
  });

  useEffect(() => {
    if (!isHydrated || session) return;

    rememberRedirectPath(redirectPath);
    void navigate({ href: "/login", replace: true });
  }, [isHydrated, navigate, redirectPath, session]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="font-display text-sm font-bold">K</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Checking session...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppMobileNav />
        <Outlet />
      </div>
    </div>
  );
}
