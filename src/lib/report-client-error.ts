/**
 * Report a client render error to structured runtime logs.
 *
 * Deliberately fire-and-forget and tiny: no cookies, no identity, no query
 * string. The server sanitizes again and rate-limits the endpoint.
 */
export function reportClientError(input: {
  message: string;
  path?: string;
  digest?: string;
}): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    message: input.message,
    path: input.path,
    digest: input.digest,
  });
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Reporting must never break the error screen itself.
  });
}
