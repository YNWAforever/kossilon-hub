import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/features/auth/auth-context-neon";
import { getAuthenticatedActor } from "@/features/auth/neon-auth-rpc";
import {
  getSafeRedirectPath,
  isDemoAuthEnabled,
  isPublicRoute,
  rememberRedirectPath,
} from "@/features/auth/route-guard";

const mobileNavItems = [
  { to: "/work-queue", label: "Work queue" },
  { to: "/portal", label: "Portal" },
  { to: "/payments", label: "Payments" },
  { to: "/whatsapp/automation", label: "Automation" },
  { to: "/annual-returns", label: "Annual returns" },
] as const;

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
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try refreshing the page.</p>
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
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ location }) => {
    if (isPublicRoute(location.pathname) || isDemoAuthEnabled()) return;

    try {
      await getAuthenticatedActor();
    } catch {
      const redirectPath = getSafeRedirectPath(location.href);
      rememberRedirectPath(redirectPath);
      throw redirect({
        href: `/login?redirect=${encodeURIComponent(redirectPath)}`,
        replace: true,
      });
    }
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
        <header className="border-b border-border bg-background px-3 py-2 md:hidden">
          <nav
            aria-label="Operational navigation"
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {mobileNavItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
                activeProps={{
                  className:
                    "rounded-md border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground",
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
