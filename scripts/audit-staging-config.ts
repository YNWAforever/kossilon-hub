const ROLES = ["ADMIN", "MANAGER", "STAFF", "CLIENT_A", "CLIENT_B"] as const;
/** Fails before Playwright can contact a target; no existing storageState. */
export function auditStagingTarget(env: Record<string, string | undefined>) {
  if (!env.AUDIT_STAGING_ORIGIN) throw new Error("BLOCKED: AUDIT_STAGING_ORIGIN is required.");
  const url = new URL(env.AUDIT_STAGING_ORIGIN);
  if (url.hostname === "kossilon-hub.vercel.app")
    throw new Error("Refusing the known production target.");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.origin !== env.AUDIT_STAGING_ORIGIN
  )
    throw new Error("An exact isolated HTTPS origin is required.");
  if (env.AUDIT_STAGING_ISOLATED !== "true" || !env.AUDIT_STAGING_APPROVAL_REF?.trim())
    throw new Error(
      "BLOCKED: isolated staging identity and explicit controlled-account approval reference required.",
    );
  if (!/^[a-f0-9]{40}$/.test(env.AUDIT_STAGING_RELEASE_SHA ?? ""))
    throw new Error("BLOCKED: verified AUDIT_STAGING_RELEASE_SHA required.");
  for (const role of ROLES) {
    for (const suffix of ["EMAIL", "PASSWORD"]) {
      const binding = `AUDIT_${role}_${suffix}`;
      if (!env[binding]?.trim())
        throw new Error(`BLOCKED: ${binding} required; no accounts will be created or invited.`);
    }
  }
  return { origin: url.origin, buildSha: env.AUDIT_STAGING_RELEASE_SHA! };
}
