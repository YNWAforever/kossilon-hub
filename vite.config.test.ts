import { describe, expect, it } from "vitest";
import type { ConfigEnv, Plugin, PluginOption } from "vite";

import createViteConfig from "./vite.config";

function flattenPlugins(plugins: PluginOption[]): Plugin[] {
  return plugins.flatMap((plugin) => {
    if (!plugin) return [];
    if (Array.isArray(plugin)) return flattenPlugins(plugin);
    return [plugin];
  });
}

describe("Vite plugin ordering", () => {
  it("injects source locations before TanStack recompiles route files", async () => {
    const env: ConfigEnv = {
      command: "serve",
      mode: "development",
      isSsrBuild: false,
      isPreview: false,
    };
    const config = await createViteConfig(env);
    const pluginNames = flattenPlugins(config.plugins ?? []).map((plugin) => plugin.name);
    const sourceInjectionIndex = pluginNames.indexOf("@tanstack/devtools:inject-source");
    const routeCompilerIndex = pluginNames.indexOf(
      "tanstack-router:code-splitter:compile-reference-file",
    );

    expect(sourceInjectionIndex).toBeGreaterThanOrEqual(0);
    expect(routeCompilerIndex).toBeGreaterThanOrEqual(0);
    expect(sourceInjectionIndex).toBeLessThan(routeCompilerIndex);
  });
});
