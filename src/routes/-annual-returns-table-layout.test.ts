import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./annual-returns.tsx", import.meta.url), "utf8");

// The case board is a CSS grid whose column template has to be repeated by the
// header row and by every data row. When those two literals were maintained
// separately the fixed tracks added up to more than the content area on a
// 1280-1440px laptop, and the grid silently overflowed: cells drew on top of
// each other instead of scrolling.
describe("annual returns case table layout", () => {
  it("defines the column template exactly once", () => {
    const templates = source.match(/lg:grid-cols-\[minmax/g) ?? [];

    expect(templates).toHaveLength(1);
    expect(source).toContain("const CASE_GRID_COLUMNS");
  });

  it("gives the flexible columns a floor so they cannot collapse to zero", () => {
    // `minmax(0, ...)` lets a track shrink to nothing under pressure, which is
    // what let the company and next-action columns collapse under their text.
    const template = source.match(/const CASE_GRID_COLUMNS =\s*"([^"]+)"/)?.[1];

    expect(template).toBeDefined();
    expect(template).not.toContain("minmax(0,");
  });

  it("scrolls the table horizontally instead of overlapping when it does not fit", () => {
    expect(source).toContain("overflow-x-auto");
    expect(source).toMatch(/lg:min-w-\[\d+px\]/);
  });

  it("keeps the horizontal floor off the stacked small-screen layout", () => {
    // Below `lg` each case renders as a labelled stack, which must stay within
    // the viewport — an unprefixed min-width would force the whole page to
    // scroll sideways on a phone.
    const unprefixed = source.match(/(?<![\w:-])min-w-\[\d+px\]/g) ?? [];

    expect(unprefixed).toEqual([]);
    expect(source).toContain("lg:min-w-[");
  });
});
