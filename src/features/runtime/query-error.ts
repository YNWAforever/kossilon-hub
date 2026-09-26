/** Only expose a bounded, plain support token supplied by the server. */
export function safeRequestId(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("requestId" in error)) return null;
  const value = error.requestId;
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/.test(value) ? value : null;
}
