import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const srcDir = new URL("../../", import.meta.url);

function tsxSourcesUnder(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return tsxSourcesUnder(new URL(`${entry.name}/`, dir));
    if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) return [];
    return [new URL(entry.name, dir).pathname];
  });
}

const relativeToSrc = (path: string) => path.slice(path.lastIndexOf("/src/") + "/src/".length);

// Text inputs, selects and textareas render through components/ui/field. Before
// it, 204 of them used 7-8 styles each. Checkboxes, radios and file pickers are
// native controls with their own look and stay raw.
describe("form field convention", () => {
  const sources = tsxSourcesUnder(srcDir).map(relativeToSrc);

  it("finds the sources it polices", () => {
    expect(sources).toContain("components/ui/field.tsx");
    expect(sources.length).toBeGreaterThan(60);
  });

  it("renders text inputs, selects and textareas through the shared field components", () => {
    const offenders = sources
      .filter((path) => !path.startsWith("components/ui/"))
      .flatMap((path) => {
        const code = readFileSync(new URL(path, srcDir), "utf8")
          .split("\n")
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
          .join("\n");
        return [...code.matchAll(/<(input|select|textarea)\b([^>]*)>/g)]
          .filter(
            ([, tag, attributes]) =>
              tag !== "input" || !/type="(checkbox|radio|file|hidden)"/.test(attributes),
          )
          .map(([match]) => `${path}: ${match.slice(0, 60)}`);
      });

    expect(offenders).toEqual([]);
  });
});
