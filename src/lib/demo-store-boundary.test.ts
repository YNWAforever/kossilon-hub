import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const srcDir = new URL("../", import.meta.url);

// The fixture stores. Anything reading one of these is holding invented data.
const DEMO_SOURCES = [
  "lib/annual-return-store",
  "lib/client-portal-store",
  "lib/app-data",
  "lib/mock-data",
];

// Every file outside src/lib that reads a fixture store, and the reason it is
// allowed to. There are exactly two valid reasons:
//
//   "gated"     branches on dataMode, so the fixture path cannot run in
//               production.
//   "demo-only" is never mounted except from inside a gated demo branch, so it
//               has no production call site to leak through.
//
// This list exists because /documents was neither. It rendered fixture rows in
// production and linked them into /annual-returns/$id with ids like
// "ar-harbour", which the production route rejects with a Zod uuid error.
// Nothing caught it, because nothing was looking.
const ALLOWED_READERS: Record<string, "gated" | "demo-only"> = {
  "components/ai-assistant-panel.tsx": "demo-only", // mounted only by the demo WhatsApp inbox
  "features/annual-return/components/demo-case-detail.tsx": "demo-only", // demo branch of /annual-returns/$id
  "features/dashboard/demo-dashboard-data.ts": "demo-only", // the dashboard's demo dependency set
  "routes/annual-returns.tsx": "gated",
  "routes/documents.tsx": "gated",
  "routes/payments.tsx": "gated",
  "routes/portal.tsx": "gated",
  "routes/settings.tsx": "gated",
  "routes/whatsapp.automation.tsx": "gated",
  "routes/whatsapp.tsx": "gated",
};

function sourcesUnder(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourcesUnder(new URL(`${entry.name}/`, dir));
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [new URL(entry.name, dir).pathname];
  });
}

const relativeToSrc = (path: string) => path.slice(path.lastIndexOf("/src/") + "/src/".length);

const read = (path: string) => readFileSync(new URL(path, srcDir), "utf8");

const importsFrom = (body: string, specifier: string) =>
  new RegExp(`from\\s+["'][^"']*${specifier}["']`).test(body);

// src/lib is where the fixtures live; readers inside it are the stores themselves.
const appSources = () =>
  sourcesUnder(srcDir)
    .map(relativeToSrc)
    .filter((path) => !path.startsWith("lib/"));

const demoStoreReaders = () =>
  appSources()
    .filter((path) => {
      const body = read(path);
      return DEMO_SOURCES.some((source) => importsFrom(body, source));
    })
    .sort();

describe("demo fixture stores stay out of production paths", () => {
  it("finds the sources it is meant to police", () => {
    // Without this, a broken traversal would make every assertion below pass
    // against an empty set.
    expect(appSources()).toContain("routes/documents.tsx");
    expect(demoStoreReaders().length).toBeGreaterThan(0);
  });

  it("is read only by files with a documented reason", () => {
    expect(demoStoreReaders()).toEqual(Object.keys(ALLOWED_READERS).sort());
  });

  it("gates every route that reads one", () => {
    // The rule /documents broke. A route is a production entry point, so if it
    // touches a fixture store it must branch on dataMode.
    const ungated = demoStoreReaders()
      .filter((path) => path.startsWith("routes/"))
      .filter((path) => !read(path).includes("dataMode"));

    expect(ungated).toEqual([]);
  });

  it("mounts demo-only files only from something that branches on dataMode", () => {
    // A demo-only file carries no gate of its own, so its safety is entirely
    // its caller's. Importing one from a component that cannot tell which mode
    // it is in is how fixtures reach a production screen.
    const demoOnly = Object.entries(ALLOWED_READERS)
      .filter(([, reason]) => reason === "demo-only")
      .map(([path]) => path);

    const leaks = demoOnly.flatMap((demoPath) => {
      const moduleName = demoPath
        .replace(/\.tsx?$/, "")
        .split("/")
        .pop()!;

      return appSources()
        .filter((path) => path !== demoPath)
        .filter((path) => importsFrom(read(path), moduleName))
        .filter((path) => {
          const body = read(path);
          // Either it picks a mode itself, or it is demo-only too and its own
          // caller carries the gate.
          return !body.includes("dataMode") && ALLOWED_READERS[path] !== "demo-only";
        })
        .map((path) => `${path} imports ${demoPath} without a dataMode branch`);
    });

    expect(leaks).toEqual([]);
  });
});
