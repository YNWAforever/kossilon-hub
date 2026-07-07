import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Building2, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { useAuth } from "@/features/auth/auth-context";
import { consumeRedirectPath } from "@/features/auth/route-guard";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login - Kossilon CoSec OS" },
      {
        name: "description",
        content: "Sign in to Kossilon Compliance Core.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { session, isHydrated, login, loginDemo, demoUsers } = useAuth();
  const [email, setEmail] = useState("admin@kossilon.test");
  const [password, setPassword] = useState("admin-demo");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isHydrated || !session) return;

    const redirectPath = consumeRedirectPath();
    void navigate({ href: redirectPath, replace: true });
  }, [isHydrated, navigate, session]);

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = login(email, password);
    setError(result.ok ? null : result.error);
  }

  function submitDemoLogin(userId: string) {
    const result = loginDemo(userId);
    setError(result.ok ? null : result.error);
  }

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      <section className="hidden min-h-screen flex-1 flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-foreground text-primary">
            <span className="font-display text-base font-bold">K</span>
          </div>
          <div>
            <div className="font-display text-lg font-semibold">Kossilon</div>
            <div className="text-xs uppercase tracking-wider text-primary-foreground/70">
              Company Secretary Operating System
            </div>
          </div>
        </div>

        <div className="max-w-xl">
          <p className="text-sm uppercase tracking-[0.2em] text-primary-foreground/60">
            Compliance Core
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight">
            Secure access for filings, client evidence, reminders, and team operations.
          </h1>
          <p className="mt-4 text-sm leading-6 text-primary-foreground/75">
            Coordinate annual returns, WhatsApp enquiries, document chasing, and approvals from one
            operating system.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs text-primary-foreground/75">
          <div className="rounded-md bg-primary-foreground/10 p-3">Annual return workflow</div>
          <div className="rounded-md bg-primary-foreground/10 p-3">Role-aware workspace</div>
          <div className="rounded-md bg-primary-foreground/10 p-3">Compliance visibility</div>
        </div>
      </section>

      <section className="flex min-h-screen w-full items-center justify-center px-6 py-10 lg:w-[500px]">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="font-display text-base font-bold">K</span>
            </div>
            <div>
              <div className="font-display text-lg font-semibold">Kossilon</div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Company Secretary OS
              </div>
            </div>
          </div>

          <div>
            <StatusPill tone="blue">Prototype access</StatusPill>
            <h2 className="mt-4 font-display text-2xl font-semibold">Sign in to Compliance Core</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Use the default admin credentials or enter with a demo identity.
            </p>
          </div>

          <form onSubmit={submitLogin} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              />
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-status-red/30 bg-status-red-soft px-3 py-2 text-xs text-status-red">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!isHydrated}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4" />
              Sign in
            </button>
          </form>

          <div className="mt-7 border-t border-border pt-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Demo identities
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
                    {user.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
