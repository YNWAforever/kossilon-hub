// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv, type ConfigEnv, type Plugin, type PluginOption } from "vite";
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

/**
 * Checkouts of other branches live under `.worktrees/` — AGENTS.md forbids
 * rebasing pushed commits, so a worktree is the normal way to hold a second
 * branch here. Their test files must never be collected:
 *
 *  - they resolve `@/` back into THIS repo, so their mocks land on the main
 *    checkout's modules and corrupt the registry, killing the whole run;
 *  - a worktree copy of a database test matches neither the `unit` project's
 *    exclude list nor the `db` project's include list (both hold repo-root-
 *    relative paths), so Vitest assigns it to `unit` — full parallelism, group 0
 *    — where it races the serialized `db` project on the same TEST_DATABASE_URL.
 *
 * This has to be declared on EACH project. A project-level `exclude` REPLACES
 * the root and CLI one rather than merging with it, which is why the
 * `vitest run --exclude .worktrees/**` this replaces silently did nothing once
 * the config grew projects. `.gitignore`, the eslint script and
 * db-integration-files.convention.test.ts's SKIP_DIRS all already know to skip
 * this directory; the test runner was the one place that did not.
 */
export const WORKTREE_EXCLUDE = "**/.worktrees/**";

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

  // Seven of the nine DB test files start with `import "dotenv/config"`, so they
  // connect to whatever TEST_DATABASE_URL `.env` holds even when the shell does
  // not export it — and `.env` is gitignored, so that is a normal local setup,
  // not an edge case. Reading only process.env here left the `db` project fully
  // parallel on exactly that path, which is the original race verbatim. loadEnv
  // resolves `.env*` the same way the tests do and returns a plain object, so
  // this stays a read: process.env is untouched for the production build.
  const testDatabaseUrl =
    process.env.TEST_DATABASE_URL || loadEnv(env.mode, process.cwd(), "").TEST_DATABASE_URL;
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
      // Only needed when there is a shared database to collide on. The guard
      // reads `.env` as well as the shell (see testDatabaseUrl above), because
      // that is where a local TEST_DATABASE_URL usually lives; with no database
      // anywhere these files skip every test and can run in parallel.
      // Measured cost with a database: ~48s -> ~82s here (+39% on other
      // hardware). Most of it is structural rather than any one slow file:
      // Vitest runs the sequential group last, so the db phase cannot overlap
      // the unit phase at all. corporate-changes/repository.test.ts (~40s solo)
      // is the largest single contributor to the serialized phase.
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            exclude: [...defaultExclude, WORKTREE_EXCLUDE, ...DB_INTEGRATION_TEST_FILES],
          },
        },
        {
          extends: true,
          test: {
            name: "db",
            include: [...DB_INTEGRATION_TEST_FILES],
            // Redundant against `include` above, which lists repo-root-relative
            // paths a worktree copy cannot match — but stated anyway so the
            // property is owned by this project rather than being a side effect
            // of how `include` happens to be spelled.
            exclude: [...defaultExclude, WORKTREE_EXCLUDE],
            fileParallelism: !testDatabaseUrl,
            // fileParallelism alone only serializes these while the root config
            // keeps `isolate: true` and groupOrder 0. Pinning this project to a
            // later group makes "runs after everything else, on its own" a
            // property of the project rather than of settings it does not own.
            sequence: { groupOrder: 1 },
          },
        },
      ],
    },
  };
}
