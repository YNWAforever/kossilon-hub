// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { ConfigEnv, Plugin, PluginOption } from "vite";
import { defaultExclude } from "vitest/config";

import { DB_INTEGRATION_TEST_FILES } from "./src/test/db-integration-files";

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
      // Vitest runs test FILES in parallel. The repository suites all share one
      // real Postgres with no per-file schema or transaction isolation, so two
      // of them in flight at once can see — and write FK children onto — each
      // other's fixtures. `fileParallelism: false` pulls this project's files
      // into Vitest's sequential group, which runs last, one file at a time,
      // while everything else keeps full parallelism.
      // Only needed when there is a shared database to collide on; without
      // TEST_DATABASE_URL these files skip every test and can run in parallel.
      // Measured cost with a database: ~48s -> ~82s. Almost all of it is one
      // file — corporate-changes/repository.test.ts runs ~40s on its own and
      // used to hide the other eight inside its own runtime. Speeding that file
      // up, not re-parallelising these, is the way to buy the time back.
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            exclude: [...defaultExclude, ...DB_INTEGRATION_TEST_FILES],
          },
        },
        {
          extends: true,
          test: {
            name: "db",
            include: [...DB_INTEGRATION_TEST_FILES],
            fileParallelism: !process.env.TEST_DATABASE_URL,
          },
        },
      ],
    },
  };
}
