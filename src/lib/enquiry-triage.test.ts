import { describe, expect, it } from "vitest";
import type { Enquiry } from "@/lib/mock-data";
import { sortEnquiriesByTriage, triageEnquiry, triageTone } from "@/lib/enquiry-triage";

function enquiry(partial: Partial<Enquiry>): Enquiry {
  return {
    id: partial.id ?? "e-test",
    contactName: partial.contactName ?? "Test Client",
    phone: partial.phone ?? "+852 9000 0000",
    lastMessage: partial.lastMessage ?? "Hello",
    lastMessageAt: partial.lastMessageAt ?? "2026-07-05T09:00:00.000Z",
    intent: partial.intent ?? "General Question",
    intentConfidence: partial.intentConfidence ?? 0.5,
    quoteStatus: partial.quoteStatus ?? "None",
    assignedTo: partial.assignedTo,
    unread: partial.unread ?? 0,
    messages: partial.messages ?? [],
  };
}

describe("enquiry triage", () => {
  it("flags deadline-sensitive annual return messages as urgent compliance work", () => {
    const triage = triageEnquiry(
      enquiry({
        lastMessage:
          "Our NAR1 annual return is overdue and the director has not signed. Will there be penalty?",
        unread: 3,
      }),
    );

    expect(triage).toMatchObject({
      intent: "Annual Return",
      band: "urgent",
      riskLevel: "high",
      routeTeam: "Filing Team A",
      requiresHumanReview: true,
    });
    expect(triage.confidence).toBeGreaterThanOrEqual(0.9);
    expect(triage.recommendedAction).toBe(
      "Open the annual-return case, verify the deadline risk, and send an approved checklist or signature follow-up.",
    );
    expect(triage.reasons).toContain("Annual return deadline language");
    expect(triage.reasons).toContain("Late filing or penalty risk");
    expect(triageTone(triage.band)).toBe("red");
  });

  it("routes incorporation pricing enquiries to new business without compliance escalation", () => {
    const triage = triageEnquiry(
      enquiry({
        lastMessage: "Hi, I want to open a HK limited company. What is your fee?",
        unread: 1,
      }),
    );

    expect(triage).toMatchObject({
      intent: "New Incorporation",
      band: "routine",
      riskLevel: "low",
      routeTeam: "New Business",
      requiresHumanReview: false,
    });
    expect(triage.recommendedAction).toBe(
      "Prepare an incorporation quote and collect KYC/company-name details.",
    );
  });

  it("requires human review for nominee director and SCR-sensitive questions", () => {
    const triage = triageEnquiry(
      enquiry({
        lastMessage: "Do you provide nominee director service? We also need help with SCR records.",
      }),
    );

    expect(triage).toMatchObject({
      intent: "General Question",
      band: "priority",
      riskLevel: "high",
      routeTeam: "Filing Team B",
      requiresHumanReview: true,
    });
    expect(triage.reasons).toContain("Compliance-sensitive keyword");
  });

  it("sorts the inbox by triage score before normal routine enquiries", () => {
    const routine = enquiry({
      id: "routine",
      lastMessage: "What is the price for opening a new company?",
      lastMessageAt: "2026-07-05T12:00:00.000Z",
      unread: 1,
    });
    const priority = enquiry({
      id: "priority",
      lastMessage: "Invoice paid by FPS just now, please check.",
      lastMessageAt: "2026-07-05T10:00:00.000Z",
      unread: 1,
    });
    const urgent = enquiry({
      id: "urgent",
      lastMessage: "NAR1 deadline is tomorrow and signature is missing.",
      lastMessageAt: "2026-07-05T08:00:00.000Z",
      unread: 0,
    });

    expect(sortEnquiriesByTriage([routine, priority, urgent]).map((item) => item.id)).toEqual([
      "urgent",
      "priority",
      "routine",
    ]);
  });
});
