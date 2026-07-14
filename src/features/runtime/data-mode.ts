export type DataMode = "demo" | "production";

export function resolveDataMode(input: {
  demoEnabled: boolean;
  isProductionBuild: boolean;
}): DataMode {
  return !input.isProductionBuild && input.demoEnabled ? "demo" : "production";
}

export function currentDataMode(): DataMode {
  return resolveDataMode({
    demoEnabled: import.meta.env.VITE_ENABLE_DEMO_AUTH === "true",
    isProductionBuild: import.meta.env.PROD,
  });
}
