import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DB_INTEGRATION_TEST_FILES } from "./db-integration-files";

const srcDir = new URL("../", import.meta.url);

// Spelled in pieces so this file does not match its own search and report
// itself as an unlisted database test.
const MARKER = ["TEST", "DATABASE", "URL"].join("_");

function testSourcesUnder(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return testSourcesUnder(new URL(`${entry.name}/`, dir));
    if (!entry.name.endsWith(".test.ts")) return [];
    return [new URL(entry.name, dir).pathname];
  });
}

const relativeToSrc = (path: string) => `src/${path.slice(path.lastIndexOf("/src/") + 5)}`;

const testSources = testSourcesUnder(srcDir).map(relativeToSrc).sort();
const touchesTheDatabase = testSources.filter((path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").includes(MARKER),
);

// vite.config.ts runs exactly these files as a serialized `db` project because
// they share one Postgres with no per-file isolation. A new repository test that
// is not on the list would silently rejoin the parallel `unit` project and start
// corrupting — and writing FK children onto — the other files' fixtures.
describe("database integration file list", () => {
  it("finds the test sources it is meant to police", () => {
    // A typo in the traversal would make the assertion below vacuously pass.
    expect(testSources).toContain("src/features/whatsapp/repository.test.ts");
    expect(testSources.length).toBeGreaterThan(50);
  });

  it("lists every test file that talks to the real database", () => {
    expect(touchesTheDatabase).toEqual([...DB_INTEGRATION_TEST_FILES].sort());
  });
});
