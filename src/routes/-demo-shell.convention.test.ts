import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = readFileSync(new URL("./__root.tsx", import.meta.url), "utf8");

describe("role-safe shell and demo chrome", () => {
  it("redirects each role to a screen it can use, in both directions", () => {
    expect(root).toContain('actor.role === "Client" && !isClientRoute(location.pathname)');
    expect(root).toContain('actor.role !== "Client" && isClientOnlyRoute(location.pathname)');
    expect(root).toContain("roleHomePath(actor.role)");
  });

  it("shows the demo banner only in demo data mode", () => {
    expect(root).toContain('{dataMode === "demo" && <DemoBanner />}');
    expect(root).toContain('import { DemoBanner } from "@/components/demo-banner";');
    expect(root).toContain("<ProtectedAppShell dataMode={dataMode} />");
  });
});
