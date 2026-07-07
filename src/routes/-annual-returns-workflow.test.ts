import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const annualReturnsRouteSource = readFileSync(
  new URL("./annual-returns.tsx", import.meta.url),
  "utf8",
);
const annualReturnDetailRouteSource = readFileSync(
  new URL("./annual-returns.$id.tsx", import.meta.url),
  "utf8",
);
const whatsappAutomationRouteSource = readFileSync(
  new URL("./whatsapp.automation.tsx", import.meta.url),
  "utf8",
);

describe("annual return workflow route regressions", () => {
  it("keeps the blockers column in the command center alongside packet and follow-up columns", () => {
    expect(annualReturnsRouteSource).toContain("<span>Blockers</span>");
    expect(annualReturnsRouteSource).toContain("<span>Packet</span>");
    expect(annualReturnsRouteSource).toContain("<span>Follow-ups</span>");
    expect(annualReturnsRouteSource).toContain('<Field label="Blockers" value={blockerSummary} />');
  });

  it("renders an explicit status column in WhatsApp automation", () => {
    expect(whatsappAutomationRouteSource).toContain("<span>Status</span>");
    expect(whatsappAutomationRouteSource).toContain('label="Status"');
    expect(whatsappAutomationRouteSource).toContain("statusToneClass(draft.status)");
  });

  it("marks filed-case owner and notes controls as read-only in the detail view", () => {
    expect(annualReturnDetailRouteSource).toContain("disabled={isFiled}");
    expect(annualReturnDetailRouteSource).toContain("readOnly={isFiled}");
    expect(annualReturnDetailRouteSource).toContain("disabled={isFiled || !note.trim()}");
  });
});
