import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./__root.tsx", import.meta.url), "utf8");

describe("zod CSP bootstrap", () => {
  it("sets zod's global jitless flag before any module bundle runs", () => {
    expect(source).toContain("globalThis.__zod_globalConfig");
    expect(source).toContain("jitless:!0");
    // Inline in <head>, ahead of the framework's head content and body scripts.
    expect(source.indexOf("ZOD_JITLESS_BOOTSTRAP")).toBeLessThan(source.indexOf("<HeadContent />"));
    expect(source).toContain(
      "<script dangerouslySetInnerHTML={{ __html: ZOD_JITLESS_BOOTSTRAP }} />",
    );
  });
});
