import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import { WorkQueueOwnerDisplay } from "./work-queue";

const item = {
  ownerId: "20000000-0000-4000-8000-000000000001",
  ownerName: "Alice Chan",
  ownerPerson: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Alice Chan",
    role: "Staff",
    teamName: "Company Secretarial",
    active: true,
  },
} as PersistedWorkItem;

describe("T05 work queue owner presentation", () => {
  it("shows the same recognisable staff identity in desktop and mobile rows", () => {
    const desktop = renderToStaticMarkup(<WorkQueueOwnerDisplay item={item} variant="desktop" />);
    const mobile = renderToStaticMarkup(<WorkQueueOwnerDisplay item={item} variant="mobile" />);
    for (const html of [desktop, mobile]) {
      expect(html).toContain("Alice Chan");
      expect(html).toContain("Company Secretarial");
      expect(html).not.toContain("Staff 20000000");
    }
    expect(desktop).toContain('role="cell"');
    expect(mobile).toContain("Owner");
  });

  it("distinguishes an unassigned item from an unresolved staff profile", () => {
    const unassigned = renderToStaticMarkup(
      <WorkQueueOwnerDisplay
        item={{ ...item, ownerId: null, ownerPerson: null }}
        variant="mobile"
      />,
    );
    const missing = renderToStaticMarkup(
      <WorkQueueOwnerDisplay item={{ ...item, ownerPerson: null }} variant="mobile" />,
    );
    expect(unassigned).toContain("Unassigned");
    expect(missing).toContain("Profile unavailable");
    expect(missing).not.toContain("Unassigned");
  });
});
