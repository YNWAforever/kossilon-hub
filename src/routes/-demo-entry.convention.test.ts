import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("gated fixture demo entry", () => {
  it("serves /demo as a server-rendered public page", () => {
    const route = read("./demo.tsx");

    expect(route).toContain('createFileRoute("/demo")');
    expect(route).toContain("ssr: true");
    expect(route).toContain('pageTitle("示範")');
    expect(route).toContain('throw redirect({ href: "/login", replace: true })');
    expect(route).toContain("isDemoAuthEnabled()");
    expect(route).toContain("DemoEntryPage");
  });

  it("keeps /demo public and out of the index", () => {
    const guard = read("../features/auth/route-guard.ts");
    const seo = read("../features/marketing/seo.ts");

    expect(guard).toContain('pathname === "/demo"');
    expect(seo).toContain('"Disallow: /demo"');
    expect(seo).not.toContain("<loc>${origin}/demo</loc>");
  });

  it("only offers the demo CTA when the build actually has a demo", () => {
    const marketing = read("../features/marketing/page.tsx");

    expect(marketing).toContain("isDemoAuthEnabled()");
    expect(marketing).toContain('href="/demo"');
  });

  it("guards the fixture build at build time", () => {
    const script = readFileSync(
      new URL("../../scripts/verify-demo-build.ts", import.meta.url),
      "utf8",
    );

    expect(script).toContain("checkDemoBuildEnv");
    expect(script).toContain("process.exit(1)");
  });
});
