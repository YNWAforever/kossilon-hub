import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createNeonAuthClient } from "./neon-auth-client";
import { getAuthenticatedActor, getNeonAuthClientConfiguration } from "./neon-auth-rpc";
import { isDemoAuthEnabled } from "./route-guard";
import {
  demoUsers,
  getStoredSession,
  isAdmin,
  loginAsDemoUser,
  loginWithCredentials,
  loginWithDemoUser,
  logout,
  type AuthSession,
  type DemoUser,
} from "./session";
import type { AuthenticatedActor, VerifiedAuthUser } from "./types";
import {
  classifyAuthError,
  authResolutionMessage,
  type AuthFailure,
  type AuthResolution,
} from "./auth-result";

type AuthActionResult = { ok: true; message?: string } | { ok: false; error: string };

type AuthContextValue = {
  session: AuthSession | null;
  isHydrated: boolean;
  resolution: AuthResolution;
  refreshSession: () => Promise<AuthResolution>;
  demoUsers: readonly DemoUser[];
  isCurrentUserAdmin: boolean;
  login: (email: string, password: string) => Promise<AuthActionResult>;
  loginWithMagicLink: (email: string) => Promise<AuthActionResult>;
  loginWithGoogle: () => Promise<AuthActionResult>;
  loginDemo: (userId: string) => Promise<AuthActionResult>;
  loginDemoUser: (user: DemoUser) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  if (isDemoAuthEnabled()) {
    return <DemoAuthProvider>{children}</DemoAuthProvider>;
  }

  return <NeonAuthBootstrap>{children}</NeonAuthBootstrap>;
}

function NeonAuthBootstrap({ children }: { children: ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<AuthFailure | null>(null);

  useEffect(() => {
    let active = true;

    void getNeonAuthClientConfiguration()
      .then((configuration) => {
        if (active) setUrl(configuration.url);
      })
      .catch((error: unknown) => {
        if (active) {
          setConfigurationError(classifyAuthError(error));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const retryConfiguration = useCallback(async (): Promise<AuthResolution> => {
    setConfigurationError(null);
    try {
      const configuration = await getNeonAuthClientConfiguration();
      setUrl(configuration.url);
      return { kind: "unauthenticated" };
    } catch (error) {
      const failure = classifyAuthError(error);
      setConfigurationError(failure);
      return failure;
    }
  }, []);

  const unavailable = useCallback(
    async (): Promise<AuthActionResult> => ({
      ok: false,
      error: configurationError
        ? authResolutionMessage(configurationError)
        : "Authentication is loading.",
    }),
    [configurationError],
  );
  const value = useMemo<AuthContextValue>(
    () => ({
      session: null,
      isHydrated: configurationError !== null,
      resolution: configurationError ?? { kind: "unauthenticated" },
      refreshSession: retryConfiguration,
      demoUsers: [],
      isCurrentUserAdmin: false,
      login: unavailable,
      loginWithMagicLink: unavailable,
      loginWithGoogle: unavailable,
      loginDemo: unavailable,
      loginDemoUser: unavailable,
      signOut: async () => undefined,
    }),
    [configurationError, retryConfiguration, unavailable],
  );

  // The useCallback/useMemo above must run unconditionally on every render —
  // React's Rules of Hooks forbid calling them after a conditional return, since
  // that would change the number of hooks this component calls between the
  // "still loading" render and the "url resolved" render below. The `value`
  // object is simply discarded on renders that take the NeonAuthProvider branch.
  if (url) {
    return <NeonAuthProvider url={url}>{children}</NeonAuthProvider>;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function toAuthSession(actor: AuthenticatedActor, user: VerifiedAuthUser): AuthSession {
  const name = user.name?.trim() || user.email;
  return {
    id: actor.userId ?? actor.authUserId,
    name,
    email: user.email,
    role: actor.role,
    initials: initials(name),
    team: actor.teamId ?? (actor.role === "Client" ? "Client portal" : "Unassigned"),
    signedInAt: new Date().toISOString(),
  };
}

function NeonAuthProvider({ children, url }: { children: ReactNode; url: string }) {
  const client = useMemo(() => createNeonAuthClient(url), [url]);
  const [resolution, setResolution] = useState<AuthResolution>({ kind: "unauthenticated" });
  const session = resolution.kind === "authenticated" ? resolution.session : null;
  const [isHydrated, setIsHydrated] = useState(false);
  const requestVersion = useRef(0);

  const refreshSession = useCallback(async (): Promise<AuthResolution> => {
    const version = ++requestVersion.current;
    setIsHydrated(false);
    setResolution({ kind: "unauthenticated" });
    let next: AuthResolution;
    try {
      const result = await client.getSession();
      if (result.error) next = classifyAuthError(result.error);
      else if (!result.data?.user) next = { kind: "unauthenticated" };
      else {
        const actor = await getAuthenticatedActor();
        if (
          !actor.active ||
          actor.authUserId !== result.data.user.id ||
          (actor.role !== "Client" && !actor.userId)
        ) {
          throw new Error("Forbidden: verified actor identity required.");
        }
        next = { kind: "authenticated", session: toAuthSession(actor, result.data.user) };
      }
      if (version !== requestVersion.current)
        return classifyAuthError(new Error("Auth refresh superseded."));
      if (version === requestVersion.current) setResolution(next);
      return next;
    } catch (error) {
      next = classifyAuthError(error);
      if (version === requestVersion.current) setResolution(next);
      return next;
    } finally {
      if (version === requestVersion.current) setIsHydrated(true);
    }
  }, [client]);

  useEffect(() => {
    void refreshSession();
    return () => {
      ++requestVersion.current;
    };
  }, [refreshSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      const result = await client.signIn.email({ email, password });
      if (result.error) {
        return { ok: false, error: result.error.message ?? "Sign in failed." };
      }

      const resolved = await refreshSession();
      return resolved.kind === "authenticated"
        ? { ok: true }
        : { ok: false, error: authResolutionMessage(resolved) };
    },
    [client, refreshSession],
  );
  const loginWithMagicLink = useCallback(
    async (email: string): Promise<AuthActionResult> => {
      const normalizedEmail = email.trim().toLowerCase();
      const result = await client.signIn.magicLink({
        email: normalizedEmail,
        callbackURL: `${window.location.origin}/login`,
        newUserCallbackURL: `${window.location.origin}/login`,
      });

      if (result.error) {
        return { ok: false, error: result.error.message ?? "Magic link request failed." };
      }

      return { ok: true, message: "Check your email for a magic link." };
    },
    [client],
  );
  const loginWithGoogle = useCallback(async (): Promise<AuthActionResult> => {
    const result = await client.signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}/login`,
      newUserCallbackURL: `${window.location.origin}/login`,
    });

    if (result.error) {
      return { ok: false, error: result.error.message ?? "Google sign-in failed." };
    }

    // better-auth's default redirectPlugin has already started navigating the
    // browser to Google at this point (see client/config.mjs — active whenever
    // the response carries {url, redirect: true}, which signIn.social's success
    // response always does). There is nothing further to do here.
    return { ok: true };
  }, [client]);
  const demoUnavailable = useCallback(
    async (): Promise<AuthActionResult> => ({
      ok: false,
      error: "Demo authentication is disabled.",
    }),
    [],
  );
  const signOut = useCallback(async () => {
    ++requestVersion.current;
    try {
      await client.signOut();
    } finally {
      setResolution({ kind: "unauthenticated" });
      setIsHydrated(true);
    }
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isHydrated,
      resolution,
      refreshSession,
      demoUsers: [],
      isCurrentUserAdmin: isAdmin(session),
      login,
      loginWithMagicLink,
      loginWithGoogle,
      loginDemo: demoUnavailable,
      loginDemoUser: demoUnavailable,
      signOut,
    }),
    [
      demoUnavailable,
      isHydrated,
      login,
      loginWithGoogle,
      loginWithMagicLink,
      session,
      signOut,
      resolution,
      refreshSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function DemoAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const refreshSession = useCallback(async (): Promise<AuthResolution> => {
    const next = getStoredSession();
    setSession(next);
    return next ? { kind: "authenticated", session: next } : { kind: "unauthenticated" };
  }, []);

  useEffect(() => {
    setSession(getStoredSession());
  }, []);

  const wrapResult = useCallback((result: ReturnType<typeof loginWithCredentials>) => {
    if (result.ok) setSession(result.session);
    return Promise.resolve<AuthActionResult>(result.ok ? { ok: true } : result);
  }, []);
  const login = useCallback(
    (email: string, password: string) => wrapResult(loginWithCredentials(email, password)),
    [wrapResult],
  );
  const loginDemo = useCallback(
    (userId: string) => wrapResult(loginAsDemoUser(userId)),
    [wrapResult],
  );
  const loginDemoUser = useCallback(
    (user: DemoUser) => wrapResult(loginWithDemoUser(user)),
    [wrapResult],
  );
  const magicLinkUnavailable = useCallback(
    async (): Promise<AuthActionResult> => ({
      ok: false,
      error: "Demo authentication is disabled.",
    }),
    [],
  );
  const signOut = useCallback(async () => {
    logout();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isHydrated: true,
      resolution: session ? { kind: "authenticated", session } : { kind: "unauthenticated" },
      refreshSession,
      demoUsers,
      isCurrentUserAdmin: isAdmin(session),
      login,
      loginWithMagicLink: magicLinkUnavailable,
      loginWithGoogle: magicLinkUnavailable,
      loginDemo,
      loginDemoUser,
      signOut,
    }),
    [login, loginDemo, loginDemoUser, magicLinkUnavailable, session, signOut, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Provider and hook share this feature module.
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
