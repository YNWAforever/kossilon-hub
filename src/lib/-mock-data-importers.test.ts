import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const srcDir = new URL("../", import.meta.url);

function sourcesUnder(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourcesUnder(new URL(`${entry.name}/`, dir));
    if (!/\.tsx?$/.test(entry.name)) return [];
    return [new URL(entry.name, dir).pathname];
  });
}

const relativeToSrc = (path: string) => path.slice(path.lastIndexOf("/src/") + "/src/".length);

// lib/mock-data is the demo fixture set. Every importer here is a known
// exception with a reason; the list is allowed to shrink and never to grow.
// Deleting an entry is the definition of done for the dashboard phase.
const ALLOWED_IMPORTERS = new Set([
  "lib/mock-data.ts", // the module itself
  "lib/mock-data.test.ts", // its own tests, if any
  "routes/index.tsx", // formatDate only
  "routes/settings.tsx", // cases + formatDate, demo-gated by settingsSectionsForMode
]);

describe("lib/mock-data importers", () => {
  it("finds the sources it is meant to police", () => {
    // A typo in the traversal would make the assertion below vacuously pass.
    expect(sourcesUnder(srcDir).map(relativeToSrc)).toContain("lib/mock-data.ts");
  });

  it("is imported only by the known exceptions", () => {
    const importers = sourcesUnder(srcDir)
      .map(relativeToSrc)
      .filter((path) => path !== "lib/mock-data.ts")
      .filter((path) =>
        /from "[^"]*lib\/mock-data"/.test(readFileSync(new URL(path, srcDir), "utf8")),
      );

    expect(importers.filter((path) => !ALLOWED_IMPORTERS.has(path))).toEqual([]);
  });
});
