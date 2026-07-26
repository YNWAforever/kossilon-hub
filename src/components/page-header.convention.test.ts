import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const srcDir = new URL("../", import.meta.url);

function tsxSourcesUnder(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return tsxSourcesUnder(new URL(`${entry.name}/`, dir));
    if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) return [];
    return [new URL(entry.name, dir).pathname];
  });
}

const relativeToSrc = (path: string) => path.slice(path.lastIndexOf("/src/") + "/src/".length);
const read = (relativePath: string) => readFileSync(new URL(relativePath, srcDir), "utf8");

const appSources = tsxSourcesUnder(srcDir).map(relativeToSrc);
const routeSources = tsxSourcesUnder(new URL("routes/", srcDir)).map(relativeToSrc);

// Screens used to split between a sticky `TopBar` and hand-rolled `<h1>` blocks,
// so the same product showed two different page headers depending on which route
// you were on. PageHeader is now the only one, and it owns the `<h1>`.
describe("page header convention", () => {
  it("finds the app sources it is meant to police", () => {
    // A typo in the traversal would make every assertion below vacuously pass.
    expect(appSources).toContain("components/page-header.tsx");
    expect(routeSources.length).toBeGreaterThan(10);
  });

  it("is the only source of <h1> in the app", () => {
    // These render their own full-screen layout instead of a page inside the app
    // shell, so their headings are not page titles.
    const ownsItsOwnHeading = new Set([
      "routes/__root.tsx", // 404 and error screens
      "routes/login.tsx", // unauthenticated layout
      "components/page-header.tsx", // the convention itself
    ]);

    const offenders = appSources
      .filter((path) => !ownsItsOwnHeading.has(path))
      .filter((path) => read(path).includes("<h1"));

    expect(offenders).toEqual([]);
  });

  it("is rendered by every route that draws a page", () => {
    const passThroughRoutes = new Set([
      "routes/__root.tsx",
      "routes/login.tsx",
      // A pass-through to the demo and production case-detail components, which
      // render the header themselves.
      "routes/annual-returns.$id.tsx",
    ]);

    const missing = routeSources
      .filter((path) => !passThroughRoutes.has(path))
      .filter((path) => !read(path).includes("<PageHeader"));

    expect(missing).toEqual([]);
  });

  it("has fully replaced the sticky top bar", () => {
    const survivors = appSources.filter((path) => read(path).includes("top-bar"));

    expect(survivors).toEqual([]);
  });
});
