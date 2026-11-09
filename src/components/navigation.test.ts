import { describe, expect, it } from "vitest";

import { navGroupsForRole } from "./navigation";

const links = (role: Parameters<typeof navGroupsForRole>[0], hiddenTo?: ReadonlySet<string>) =>
  navGroupsForRole(role, { hiddenTo }).flatMap((group) => group.items.map((item) => item.to));

describe("role and capability aware navigation", () => {
  it("gives an Admin the WhatsApp group by default", () => {
    const paths = links("Admin");
    expect(paths).toContain("/whatsapp");
    expect(paths).toContain("/whatsapp/automation");
  });

  it("removes both WhatsApp entries (and the empty group) when hidden", () => {
    const hidden = new Set(["/whatsapp", "/whatsapp/automation"]);
    const groups = navGroupsForRole("Admin", { hiddenTo: hidden });
    const paths = groups.flatMap((group) => group.items.map((item) => item.to));

    expect(paths).not.toContain("/whatsapp");
    expect(paths).not.toContain("/whatsapp/automation");
    expect(groups.some((group) => group.heading === "通訊")).toBe(false);
    // The rest of the navigation is untouched.
    expect(paths).toContain("/dashboard");
    expect(paths).toContain("/operations");
  });

  it("keeps the Client navigation limited to documents and portal", () => {
    expect(links("Client").sort()).toEqual(["/documents", "/portal"]);
  });

  it("returns no groups without a role", () => {
    expect(navGroupsForRole(undefined)).toEqual([]);
  });
});
