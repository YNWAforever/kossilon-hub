export type ProviderMode = "local" | "simulated" | "live";

export function resolveProviderMode(input: {
  requested: ProviderMode;
  isProductionBuild: boolean;
  firmId?: string;
}): ProviderMode {
  if (input.isProductionBuild && input.requested === "local") {
    throw new Error("Local providers are unavailable in production builds.");
  }
  if (input.requested === "simulated" && input.firmId !== "kossilon-demo") {
    throw new Error("Simulated providers are available only for kossilon-demo.");
  }

  return input.requested;
}

/**
 * Reads a configured mode, and refuses to guess.
 *
 * Two separate defects lived in the one-line version this replaces,
 * `configured === "local" || configured === "simulated" ? configured : "live"`.
 *
 * It compared the raw value, while the demo safety check in
 * scripts/validate-neon-auth-demo.ts trims and lowercases before comparing. So
 * `VITE_PROVIDER_MODE=Simulated` PASSED the check that exists to confirm a
 * deployment is a safe demo, and then resolved to live at runtime -- real
 * WOZTELL sends and real Resend email to real clients from a deployment
 * everything said was simulated.
 *
 * And an unrecognised value fell through to `live`, which is the most dangerous
 * of the three. An absent value defaulting to live is deliberate: production
 * sets nothing. A value that is present but unrecognised means somebody tried to
 * configure this and got it wrong, and the safe answer to a typo is not "send
 * real messages".
 *
 * The value is not echoed in the error. Binding values are never reported here,
 * only names.
 */
export function normalizeProviderMode(configured: unknown): ProviderMode {
  if (typeof configured !== "string" || configured.trim() === "") return "live";

  const normalized = configured.trim().toLowerCase();
  if (normalized === "local" || normalized === "simulated" || normalized === "live") {
    return normalized;
  }

  throw new Error(
    "VITE_PROVIDER_MODE is set to an unrecognised value. Expected local, simulated or live.",
  );
}

export function currentProviderMode(): ProviderMode {
  const requested = normalizeProviderMode(import.meta.env.VITE_PROVIDER_MODE);
  const firmId = typeof process === "undefined" ? undefined : process.env.FIRM_ID;

  return resolveProviderMode({
    requested,
    isProductionBuild: import.meta.env.PROD,
    firmId,
  });
}
