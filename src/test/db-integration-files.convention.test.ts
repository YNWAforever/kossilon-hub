import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DB_INTEGRATION_TEST_FILES } from "./db-integration-files";

const repoRoot = new URL("../../", import.meta.url);

// Spelled in pieces so this file does not match its own search and report
// itself as an unlisted database test.
const MARKER = ["TEST", "DATABASE", "URL"].join("_");

// Build output and checkouts of other branches contain their own copies of
// these tests; walking into them would report phantom drift.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  ".output",
  ".wrangler",
  "dist",
  "coverage",
]);

// Tests here are `*.test.ts(x)` (see CLAUDE.md) and live outside src/ too:
// scripts/ has its own suites and vite.config.test.ts sits at the root.
const isTestFile = (name: string) => name.endsWith(".test.ts") || name.endsWith(".test.tsx");

function testSourcesUnder(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) return [];
      return testSourcesUnder(new URL(`${entry.name}/`, dir));
    }
    if (!isTestFile(entry.name)) return [];
    return [new URL(entry.name, dir).pathname];
  });
}

const rootPath = repoRoot.pathname;
const relativeToRoot = (path: string) =>
  path.startsWith(rootPath) ? path.slice(rootPath.length) : path;

const testSources = testSourcesUnder(repoRoot).map(relativeToRoot).sort();
const touchesTheDatabase = testSources.filter((path) =>
  readFileSync(new URL(path, repoRoot), "utf8").includes(MARKER),
);

// vite.config.ts runs exactly these files as a serialized `db` project because
// they share one Postgres with no per-file isolation. A new repository test that
// is not on the list would silently rejoin the parallel `unit` project and start
// corrupting — and writing FK children onto — the other files' fixtures.
describe("database integration file list", () => {
  it("finds the test sources it is meant to police", () => {
    // A traversal that missed an extension or a directory would make the
    // assertion below vacuously pass, which is how drift gets through.
    expect(testSources).toContain("src/features/whatsapp/repository.test.ts");
    expect(testSources).toContain("vite.config.test.ts");
    expect(testSources.some((path) => path.startsWith("scripts/"))).toBe(true);
    expect(testSources.some((path) => path.endsWith(".test.tsx"))).toBe(true);
    expect(testSources.length).toBeGreaterThan(100);
  });

  it("lists every test file that talks to the real database", () => {
    expect(touchesTheDatabase).toEqual([...DB_INTEGRATION_TEST_FILES].sort());
  });
});
