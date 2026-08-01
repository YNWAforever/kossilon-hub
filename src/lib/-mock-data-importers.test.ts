import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const srcDir = new URL("../", import.meta.url);

const MOCK_DATA = "lib/mock-data.ts";
// This file quotes specimen import statements below, so it matches itself.
const SELF = "lib/-mock-data-importers.test.ts";

// Every way a module can be pulled in: static import/export, dynamic import(),
// require(), and vi.mock() — either quote style, extension optional. A form
// this misses is a form the ratchet cannot police, which is why the forms are
// asserted individually rather than trusted.
const IMPORT_PATTERN =
  /(?:from|import|require|vi\.mock)\s*\(?\s*["'][^"']*lib\/mock-data(?:\.tsx?)?["']/;

// lib/mock-data is the demo fixture set. Sixteen files imported it before the
// orphaned screens were deleted, and the dashboard dropped off it when
// formatDate moved out. Settings is the last one, and its usage is demo-gated.
// Emptying this list retires the fixture module — the assertion is exact, so
// the list shrinks by deliberate edit and never drifts.
const EXPECTED_IMPORTERS = [
  "routes/settings.tsx", // cases only, demo-gated by settingsSectionsForMode
];

function sourcesUnder(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourcesUnder(new URL(`${entry.name}/`, dir));
    if (!/\.tsx?$/.test(entry.name)) return [];
    return [new URL(entry.name, dir).pathname];
  });
}

const relativeToSrc = (path: string) => path.slice(path.lastIndexOf("/src/") + "/src/".length);

describe("lib/mock-data importers", () => {
  it("finds the sources it is meant to police", () => {
    // A typo in the traversal would make the assertion below report an empty
    // set, which reads identically to a clean codebase.
    expect(sourcesUnder(srcDir).map(relativeToSrc)).toContain(MOCK_DATA);
  });

  it("recognises every form an import can take", () => {
    const forms = [
      'import { cases } from "@/lib/mock-data";',
      "import { cases } from '@/lib/mock-data';",
      'import type { Enquiry } from "../lib/mock-data";',
      'import { cases } from "@/lib/mock-data.ts";',
      'import "@/lib/mock-data";',
      'export { cases } from "@/lib/mock-data";',
      'export * from "@/lib/mock-data";',
      'const fixtures = await import("@/lib/mock-data");',
      'require("@/lib/mock-data")',
      'vi.mock("@/lib/mock-data", () => ({}));',
    ];

    for (const form of forms) {
      expect(IMPORT_PATTERN.test(form), form).toBe(true);
    }

    // Neighbouring module names must not be swept up.
    expect(IMPORT_PATTERN.test('import { cases } from "@/lib/mock-data-store";')).toBe(false);
  });

  it("is imported only by the known exceptions", () => {
    const importers = sourcesUnder(srcDir)
      .map(relativeToSrc)
      .filter((path) => path !== MOCK_DATA && path !== SELF)
      .filter((path) => IMPORT_PATTERN.test(readFileSync(new URL(path, srcDir), "utf8")))
      .sort();

    expect(importers).toEqual(EXPECTED_IMPORTERS);
  });
});
