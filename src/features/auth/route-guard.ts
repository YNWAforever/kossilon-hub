export const AUTH_REDIRECT_STORAGE_KEY = "kossilon.auth.redirect.v1";

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): SessionStorageLike | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isPublicRoute(pathname: string): boolean {
  return pathname === "/login";
}

function normalizeRedirectPath(path: string | null): string {
  if (
    !path ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path === "/login" ||
    path.startsWith("/login?") ||
    path.startsWith("/login#")
  ) {
    return "/";
  }

  return path;
}

export function rememberRedirectPath(path: string, storage = browserStorage()): void {
  if (!storage) return;

  try {
    storage.setItem(AUTH_REDIRECT_STORAGE_KEY, normalizeRedirectPath(path));
  } catch {
    // Redirect memory is optional; navigation should continue if storage is unavailable.
  }
}

export function consumeRedirectPath(storage = browserStorage()): string {
  if (!storage) return "/";

  try {
    const path = normalizeRedirectPath(storage.getItem(AUTH_REDIRECT_STORAGE_KEY));
    storage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
    return path;
  } catch {
    return "/";
  }
}
