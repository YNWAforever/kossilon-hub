import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const routesDir = new URL("./", import.meta.url);

// A flat-file child such as incorporation.$id.tsx renders only through its
// parent's <Outlet />. The incorporation and corporate-change parents had
// none, so opening a case changed the URL and left the list on screen: both
// detail screens were unreachable.
describe("nested route convention", () => {
  const routes = readdirSync(routesDir).filter(
    (name) => name.endsWith(".tsx") && !name.startsWith("-") && name !== "__root.tsx",
  );
  const parents = routes.filter((name) =>
    routes.some((child) => child.startsWith(name.replace(/\.tsx$/, ".$"))),
  );

  it("finds the parent routes it polices", () => {
    expect(parents).toEqual(
      expect.arrayContaining([
        "annual-returns.tsx",
        "clients.tsx",
        "corporate-changes.tsx",
        "incorporation.tsx",
      ]),
    );
  });

  it("renders an Outlet in every route that has child routes", () => {
    const withoutOutlet = parents.filter(
      (name) => !readFileSync(new URL(name, routesDir), "utf8").includes("<Outlet />"),
    );

    expect(withoutOutlet).toEqual([]);
  });
});
