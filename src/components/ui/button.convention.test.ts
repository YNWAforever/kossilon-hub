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

// Every action renders through components/ui/button. Before it existed, 204
// buttons used 28 different visual styles. These are the raw <button>s that
// are deliberately not "buttons" to look at, with how many each file has:
// tab bars with an underline style, and whole-row or list-item click targets.
const ALLOWED_RAW_BUTTONS: Record<string, number> = {
  "routes/settings.tsx": 2, // template list rows, tab bar
  "features/annual-return/components/demo-case-detail.tsx": 2, // checklist and packet rows
  "routes/work-queue.tsx": 1, // assignee recommendation card
  "routes/whatsapp.tsx": 1, // conversation rows
  "features/whatsapp/components/production-inbox.tsx": 1, // conversation rows
  "routes/login.tsx": 1, // demo identity rows
  "routes/imports.tsx": 1, // previous-import rows
  "routes/admin.tsx": 1, // tab bar
};

describe("button convention", () => {
  const sources = tsxSourcesUnder(srcDir).map(relativeToSrc);

  it("finds the sources it polices", () => {
    expect(sources).toContain("components/ui/button.tsx");
    expect(sources.length).toBeGreaterThan(60);
  });

  it("renders actions through <Button> rather than a hand-styled <button>", () => {
    const counts = Object.fromEntries(
      sources
        .filter((path) => !path.startsWith("components/ui/"))
        .map((path) => [
          path,
          (readFileSync(new URL(path, srcDir), "utf8").match(/<button\b/g) ?? []).length,
        ])
        .filter(([, count]) => (count as number) > 0),
    );

    expect(counts).toEqual(ALLOWED_RAW_BUTTONS);
  });
});
