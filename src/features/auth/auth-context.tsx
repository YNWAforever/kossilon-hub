import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  demoUsers,
  getStoredSession,
  isAdmin,
  loginAsDemoUser,
  loginWithCredentials,
  loginWithDemoUser,
  logout,
  type AuthResult,
  type AuthSession,
  type DemoUser,
} from "./session";

type AuthContextValue = {
  session: AuthSession | null;
  isHydrated: boolean;
  demoUsers: typeof demoUsers;
  isCurrentUserAdmin: boolean;
  login: (email: string, password: string) => AuthResult;
  loginDemo: (userId: string) => AuthResult;
  loginDemoUser: (user: DemoUser) => AuthResult;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setSession(getStoredSession());
    setIsHydrated(true);
  }, []);

  const login = useCallback((email: string, password: string) => {
    const result = loginWithCredentials(email, password);
    if (result.ok) setSession(result.session);
    return result;
  }, []);

  const loginDemo = useCallback((userId: string) => {
    const result = loginAsDemoUser(userId);
    if (result.ok) setSession(result.session);
    return result;
  }, []);

  const loginDemoUser = useCallback((user: DemoUser) => {
    const result = loginWithDemoUser(user);
    if (result.ok) setSession(result.session);
    return result;
  }, []);

  const signOut = useCallback(() => {
    logout();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isHydrated,
      demoUsers,
      isCurrentUserAdmin: isAdmin(session),
      login,
      loginDemo,
      loginDemoUser,
      signOut,
    }),
    [isHydrated, login, loginDemo, loginDemoUser, session, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- AuthProvider and useAuth share this task-scoped module.
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return value;
}
