const AUTH_PROXY_PREFIX = "/api/auth/";
const NEON_AUTH_COOKIE_PREFIX = "__Secure-neon-auth";
const SUPPORTED_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
const REQUEST_HEADERS = ["user-agent", "authorization", "referer", "content-type"] as const;
const RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-encoding",
  "location",
  "set-auth-jwt",
  "set-auth-token",
  "x-neon-ret-request-id",
] as const;

type SupportedMethod = (typeof SUPPORTED_METHODS)[number];

type NeonAuthProxyConfig = {
  baseUrl: string;
  fetcher?: typeof fetch;
};

function neonCookies(cookieHeader: string | null): string {
  if (!cookieHeader) return "";

  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(NEON_AUTH_COOKIE_PREFIX))
    .join("; ");
}

function firstPartyCookie(cookieHeader: string): string {
  const attributes = cookieHeader
    .split(";")
    .map((attribute) => attribute.trim())
    .filter(
      (attribute) =>
        !/^domain=/i.test(attribute) &&
        !/^samesite=/i.test(attribute) &&
        !/^partitioned$/i.test(attribute),
    );

  attributes.push("SameSite=Strict");
  return attributes.join("; ");
}

function setCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (getSetCookie) return getSetCookie.call(headers);

  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function upstreamHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const origin =
    request.headers.get("origin") ??
    request.headers.get("referer")?.split("/").slice(0, 3).join("/") ??
    new URL(request.url).origin;
  headers.set("origin", origin);
  headers.set("cookie", neonCookies(request.headers.get("cookie")));
  headers.set("x-neon-auth-middleware", "true");
  return headers;
}

function proxyResponse(response: Response): Response {
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const cookie of setCookieHeaders(response.headers)) {
    headers.append("set-cookie", firstPartyCookie(cookie));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createNeonAuthProxy({ baseUrl, fetcher = fetch }: NeonAuthProxyConfig) {
  const normalizedBaseUrl = new URL(baseUrl);
  if (normalizedBaseUrl.protocol !== "https:") {
    throw new Error("Neon Auth URL must use HTTPS.");
  }
  const authBaseUrl = normalizedBaseUrl.toString().replace(/\/$/, "");

  return async (request: Request): Promise<Response> => {
    const requestUrl = new URL(request.url);
    if (!requestUrl.pathname.startsWith(AUTH_PROXY_PREFIX)) {
      throw new Error("Request is outside the Neon Auth proxy path.");
    }

    const method = request.method.toUpperCase();
    if (!SUPPORTED_METHODS.includes(method as SupportedMethod)) {
      return new Response(null, {
        status: 405,
        headers: { allow: SUPPORTED_METHODS.join(", ") },
      });
    }

    const path = requestUrl.pathname.slice(AUTH_PROXY_PREFIX.length);
    if (!path) throw new Error("Request is outside the Neon Auth proxy path.");

    const upstreamUrl = new URL(`${authBaseUrl}/${path}`);
    upstreamUrl.search = requestUrl.search;
    const response = await fetcher(upstreamUrl, {
      method,
      headers: upstreamHeaders(request),
      body: request.body ? await request.text() : undefined,
      redirect: "manual",
    });

    return proxyResponse(response);
  };
}
