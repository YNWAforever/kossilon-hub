import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = readFileSync(new URL("./__root.tsx", import.meta.url), "utf8");

describe("role-safe shell and demo chrome", () => {
  it("redirects a Client to the screen it can use", () => {
    expect(root).toContain('actor.role === "Client" && !isClientRoute(location.pathname)');
    expect(root).toContain("roleHomePath(actor.role)");
  });

  it("gives keyboard users a skip link to the main content", () => {
    expect(root).toContain('href="#main-content"');
    expect(root).toContain('id="main-content"');
    expect(root).toContain("跳至主要內容");
    // The target must be focusable or the browser will not move focus for a skip link.
    expect(root).toContain("tabIndex={-1}");
  });

  it("shows the demo banner only in demo data mode", () => {
    expect(root).toContain('{dataMode === "demo" && <DemoBanner />}');
    expect(root).toContain('import { DemoBanner } from "@/components/demo-banner";');
    // The shell keeps its no-prop contract; the banner decides on route context.
    expect(root).toContain("<ProtectedAppShell />");
    expect(root).toContain("const { dataMode } = Route.useRouteContext();");
  });
});
