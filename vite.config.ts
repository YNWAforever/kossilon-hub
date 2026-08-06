// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { ConfigEnv, Plugin, PluginOption } from "vite";

const createConfig = defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // The Worker entry is nitro's, not ours: its `scheduled` only fires the
  // `cloudflare:scheduled` hook, so a `scheduled` export on the server entry is
  // never invoked. This plugin registers that hook — it is what connects
  // wrangler's five-minute cron to runFirmMaintenance.
  //
  // Cast because @lovable.dev/vite-tanstack-config types its `nitro` surface
  // narrowly on purpose ("only stable build-time knobs", Nitro v3 being pre-RC)
  // while forwarding the whole object to `nitro()` from nitro/vite. `plugins` is
  // a standard nitro option and is honoured — src/server/cron-wiring.test.ts and
  // the verify:firm cron gate both check it stays registered.
  nitro: {
    plugins: ["./src/server/nitro-scheduled.ts"],
  } as unknown as { preset?: string },
});

export async function flattenPlugins(plugins: PluginOption[]): Promise<Plugin[]> {
  const groups = await Promise.all(
    plugins.map(async (candidate) => {
      const plugin = await candidate;
      if (!plugin) return [];
      return Array.isArray(plugin) ? flattenPlugins(plugin) : [plugin];
    }),
  );
  return groups.flat();
}

export default async function config(env: ConfigEnv) {
  const resolved = await createConfig(env);
  const plugins = await flattenPlugins(resolved.plugins ?? []);
  const sourceInjectionIndex = plugins.findIndex(
    (plugin) => plugin.name === "@tanstack/devtools:inject-source",
  );

  // Source locations must be captured before TanStack reformats route modules.
  if (sourceInjectionIndex > 0) {
    const [sourceInjection] = plugins.splice(sourceInjectionIndex, 1);
    plugins.unshift(sourceInjection);
  }

  return {
    ...resolved,
    plugins,
    test: {
      // The validator/CLI suites spawn `node --experimental-strip-types`
      // subprocesses that take ~5s to boot, which sits right on Vitest's 5000ms
      // default and made them fail intermittently under load.
      ...(resolved as { test?: Record<string, unknown> }).test,
      testTimeout: 30_000,
    },
  };
}
