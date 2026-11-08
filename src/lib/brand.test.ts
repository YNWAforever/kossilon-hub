import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const BRAND_FILE = fileURLToPath(new URL("./brand.ts", import.meta.url));
const FORBIDDEN = [
  "Kossilon CoSec OS",
  "Kossilon Hub",
  "Kossilon Compliance Core",
  "Compliance Core",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(name)) return [];
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) return [];
    if (path === BRAND_FILE) return [];
    return [path];
  });
}

// The public site has said "ComSec OS" since 2026-10-28. The app and auth email
// said two other names; one constant is the only place a rename belongs.
describe("brand convention", () => {
  it("has one app-facing product name", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) =>
      FORBIDDEN.some((name) => readFileSync(file, "utf8").includes(name)),
    );

    expect(offenders.map((file) => file.slice(SRC.length))).toEqual([]);
  });
});
