import { describe, expect, it } from "vitest";
import type { ConfigEnv, PluginOption } from "vite";

import createViteConfig, { flattenPlugins } from "./vite.config";

describe("Vite plugin ordering", () => {
  it("flattens promised plugin options without changing their order", async () => {
    const plugins: PluginOption[] = [
      { name: "first" },
      Promise.resolve([{ name: "second" }, false, [{ name: "third" }]]),
    ];

    await expect(flattenPlugins(plugins)).resolves.toEqual([
      expect.objectContaining({ name: "first" }),
      expect.objectContaining({ name: "second" }),
      expect.objectContaining({ name: "third" }),
    ]);
  });

  it("injects source locations before TanStack recompiles route files", async () => {
    const env: ConfigEnv = {
      command: "serve",
      mode: "development",
      isSsrBuild: false,
      isPreview: false,
    };
    const config = await createViteConfig(env);
    const pluginNames = (await flattenPlugins(config.plugins ?? [])).map((plugin) => plugin.name);
    const sourceInjectionIndex = pluginNames.indexOf("@tanstack/devtools:inject-source");
    const routeCompilerIndex = pluginNames.indexOf(
      "tanstack-router:code-splitter:compile-reference-file",
    );

    expect(sourceInjectionIndex).toBeGreaterThanOrEqual(0);
    expect(routeCompilerIndex).toBeGreaterThanOrEqual(0);
    expect(sourceInjectionIndex).toBeLessThan(routeCompilerIndex);
  }, 15_000);
});
