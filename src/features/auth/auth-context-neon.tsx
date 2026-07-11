import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createNeonAuthClient } from "./neon-auth-client";
import {
  getAuthenticatedActor,
  getNeonAuthClientConfiguration,
} from "./neon-auth-rpc";
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

type AuthActionResult = { ok: true } | { ok: false; error: string };

type AuthContextValue = {
  session: AuthSession | null;
  isHydrated: boolean;
  demoUsers: readonly DemoUser[];
  isCurrentUserAdmin: boolean;
  login: (email: string, password: string) => Promise<AuthActionResult>;
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
  const [configurationError, setConfigurationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void getNeonAuthClientConfiguration()
      .then((configuration) => {
        if (active) setUrl(configuration.url);
      })
      .catch((error: unknown) => {
        if (active) {
          setConfigurationError(error instanceof Error ? error.message : "Authentication unavailable.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (url) {
    return <NeonAuthProvider url={url}>{children}</NeonAuthProvider>;
  }

  const unavailable = async (): Promise<AuthActionResult> => ({
    ok: false,
    error: configurationError ?? "Authentication is loading.",
  });
  const value: AuthContextValue = {
    session: null,
    isHydrated: configurationError !== null,
    demoUsers: [],
    isCurrentUserAdmin: false,
    login: unavailable,
    loginDemo: unavailable,
    loginDemoUser: unavailable,
    signOut: async () => undefined,
  };

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
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const refreshSession = useCallback(async () => {
    setIsHydrated(false);
    const result = await client.getSession();

    if (!result.data?.user) {
      setSession(null);
      setIsHydrated(true);
      return;
    }

    try {
      const actor = await getAuthenticatedActor();
      setSession(toAuthSession(actor, result.data.user));
    } catch {
      setSession(null);
    } finally {
      setIsHydrated(true);
    }
  }, [client]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      const result = await client.signIn.email({ email, password });
      if (result.error) {
        return { ok: false, error: result.error.message ?? "Sign in failed." };
      }

      await refreshSession();
      return { ok: true };
    },
    [client, refreshSession],
  );
  const demoUnavailable = useCallback(async (): Promise<AuthActionResult> => ({
    ok: false,
    error: "Demo authentication is disabled.",
  }), []);
  const signOut = useCallback(async () => {
    await client.signOut();
    setSession(null);
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isHydrated,
      demoUsers: [],
      isCurrentUserAdmin: isAdmin(session),
      login,
      loginDemo: demoUnavailable,
      loginDemoUser: demoUnavailable,
      signOut,
    }),
    [demoUnavailable, isHydrated, login, session, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function DemoAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);

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
  const signOut = useCallback(async () => {
    logout();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isHydrated: true,
      demoUsers,
      isCurrentUserAdmin: isAdmin(session),
      login,
      loginDemo,
      loginDemoUser,
      signOut,
    }),
    [login, loginDemo, loginDemoUser, session, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Provider and hook share this feature module.
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
