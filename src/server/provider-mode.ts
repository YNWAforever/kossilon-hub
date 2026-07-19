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

export function currentProviderMode(): ProviderMode {
  const configured = import.meta.env.VITE_PROVIDER_MODE;
  const requested: ProviderMode =
    configured === "local" || configured === "simulated" ? configured : "live";
  const firmId = typeof process === "undefined" ? undefined : process.env.FIRM_ID;

  return resolveProviderMode({
    requested,
    isProductionBuild: import.meta.env.PROD,
    firmId,
  });
}
