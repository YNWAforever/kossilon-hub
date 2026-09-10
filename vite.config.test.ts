import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import type { ConfigEnv, PluginOption } from "vite";

import createViteConfig, { flattenPlugins, WORKTREE_EXCLUDE } from "./vite.config";

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

/**
 * `npm run test` used to carry `--exclude .worktrees/**`, which stopped doing
 * anything the moment the config grew `projects`: a project-level `exclude`
 * REPLACES the root and CLI one instead of merging. Measured before the fix —
 * `vitest list --exclude "**\/phone.test.ts" src/features/whatsapp` collected the
 * same 7 files as the run with no flag at all.
 *
 * The cost of that was not theoretical. A worktree copy of a database test
 * matches neither the `unit` exclude list nor the `db` include list, so Vitest
 * put it in `unit` — full parallelism, group 0 — pointed at the same Postgres as
 * the serialized `db` project, which is the race the two projects exist to
 * prevent.
 *
 * Note for future editors: do not spell the database env var in full anywhere in
 * this file. db-integration-files.convention.test.ts greps every *.test.ts for
 * that literal to decide which suites are database suites, so naming it here
 * makes this config test report itself as one.
 */
describe("worktree checkouts are excluded by the config, not by a CLI flag", () => {
  const testProjects = async () => {
    const config = await createViteConfig({
      command: "serve",
      mode: "test",
      isSsrBuild: false,
      isPreview: false,
    });
    return (
      config.test as {
        projects: { test: { name: string; exclude?: string[]; include?: string[] } }[];
      }
    ).projects;
  };

  it("declares the worktree glob on every project", async () => {
    const projects = await testProjects();

    // Every project, not just `unit`: an exclude declared on one project says
    // nothing about the others, and a future third project would inherit
    // nothing from these two.
    expect(projects.length).toBeGreaterThan(0);
    for (const project of projects) {
      expect(project.test.exclude, `project "${project.test.name}" has no exclude`).toBeDefined();
      expect(
        project.test.exclude,
        `project "${project.test.name}" does not exclude worktree checkouts`,
      ).toContain(WORKTREE_EXCLUDE);
    }
  }, 15_000);

  it("matches a worktree copy of a database test", async () => {
    const projects = await testProjects();
    const unit = projects.find((project) => project.test.name === "unit");
    const db = projects.find((project) => project.test.name === "db");

    // The specific path that used to slip through: repo-root-relative entries
    // like "src/features/whatsapp/repository.test.ts" cannot match it, so
    // neither the unit exclude list nor the db include list caught it.
    const worktreeCopy = ".worktrees/probe/src/features/whatsapp/repository.test.ts";

    expect(unit?.test.exclude).toContain(WORKTREE_EXCLUDE);
    expect(db?.test.include).not.toContain(worktreeCopy);
    expect(WORKTREE_EXCLUDE).toBe("**/.worktrees/**");
  }, 15_000);

  it("no longer relies on the inert CLI flag", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    // Keeping the flag would not be harmful, but it reads as though it works.
    expect(packageJson.scripts?.test).toBe("vitest run");
  });
});
