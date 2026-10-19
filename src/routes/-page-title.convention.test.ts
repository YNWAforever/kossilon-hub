import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const routesDir = new URL("./", import.meta.url);

// Thirteen screens shared one generic tab title, so open tabs and history
// entries could not be told apart (WCAG 2.4.2 Page Titled). Every page route
// now names itself through pageTitle().
describe("page title convention", () => {
  const routes = readdirSync(routesDir).filter(
    (name) => name.endsWith(".tsx") && !name.startsWith("-") && name !== "__root.tsx",
  );

  it("finds the route files it polices", () => {
    expect(routes.length).toBeGreaterThan(15);
  });

  it("gives every route its own tab title", () => {
    const untitled = routes.filter(
      (name) => !/title: pageTitle\("[^"]+"\)/.test(readFileSync(new URL(name, routesDir), "utf8")),
    );

    expect(untitled).toEqual([]);
  });

  it("never gives two routes the same title", () => {
    const titles = routes.map(
      (name) =>
        readFileSync(new URL(name, routesDir), "utf8").match(/title: pageTitle\("([^"]+)"\)/)?.[1],
    );

    expect(new Set(titles).size).toBe(titles.length);
  });
});
