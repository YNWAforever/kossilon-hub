import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcDir = new URL("../", import.meta.url);

function sourcesUnder(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourcesUnder(new URL(`${entry.name}/`, dir));
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [fileURLToPath(new URL(entry.name, dir))];
  });
}

// The base status colours are tuned to be vivid as dots and fills. As small
// text on their soft backgrounds they measured 2.2-4.0:1 (axe, WCAG AA needs
// 4.5:1), so text uses the darker `-text` variants defined in styles.css, at
// full opacity.
describe("status text contrast convention", () => {
  const sources = sourcesUnder(srcDir);

  it("finds the sources it polices", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("never sets text in a base status colour or a faded -text variant", () => {
    const offenders = sources.flatMap((path) =>
      [
        ...readFileSync(path, "utf8").matchAll(
          /\btext-status-(?:green|yellow|orange|red|blue)(?:(?![-\w])|-text\/\d+)/g,
        ),
      ].map((match) => `${path.slice(path.lastIndexOf("/src/") + 1)}: ${match[0]}`),
    );

    expect(offenders).toEqual([]);
  });
});
