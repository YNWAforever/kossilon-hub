import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "jsonc-parser";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const npmLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const bunLock = parse(readFileSync("bun.lock", "utf8"));

describe("portable single-repository dependency locks", () => {
  it("locks exactly the authorized direct dependency set in both installers", () => {
    for (const group of ["dependencies", "devDependencies"]) {
      expect(npmLock.packages[""][group]).toEqual(manifest[group]);
      expect(bunLock.workspaces[""][group]).toEqual(manifest[group]);
    }
  });

  it("does not import a parent checkout or local filesystem link into npm installs", () => {
    const externalEntries = Object.entries(npmLock.packages).filter(([path, value]) => {
      const entry = value as { link?: boolean; resolved?: string };
      return (
        path.split("/").includes("..") ||
        entry.link === true ||
        /^file:|^\.\.?\//.test(entry.resolved ?? "")
      );
    });
    expect(externalEntries).toEqual([]);
  });
});
