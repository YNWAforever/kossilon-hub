export type ProviderMode = "local" | "live";

export function resolveProviderMode(input: {
  requested: ProviderMode;
  isProductionBuild: boolean;
}): ProviderMode {
  if (input.isProductionBuild && input.requested === "local") {
    throw new Error("Local providers are unavailable in production builds.");
  }

  return input.requested;
}

export function currentProviderMode(): ProviderMode {
  return resolveProviderMode({
    requested: import.meta.env.VITE_PROVIDER_MODE === "local" ? "local" : "live",
    isProductionBuild: import.meta.env.PROD,
  });
}
