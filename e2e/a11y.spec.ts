import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { expect, test, type Page } from "@playwright/test";

const require = createRequire(import.meta.url);
// Inject the pinned package source instead of fetching a CDN copy, so CI and a
// local run scan exactly the audited axe version from the lockfile.
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

type AxeNode = { target: string[] };
type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: AxeNode[];
};
type AxeResults = { violations: AxeViolation[] };
type AxeWindow = {
  axe: { run: (context: Document, options: unknown) => Promise<AxeResults> };
};

async function scan(page: Page) {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    const axe = (window as unknown as AxeWindow).axe;
    return axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
  });

  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    blocking.map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} @ ${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    ),
  ).toEqual([]);
}

const entryPages = [
  ["zh-HK login", "/login"],
  ["en login", "/en/login"],
  ["zh-HK request access", "/request-access"],
  ["en request access", "/en/request-access"],
] as const;

test.describe("entry accessibility", () => {
  for (const [name, path] of entryPages) {
    test(`${name} has no serious WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await scan(page);
    });
  }
});
