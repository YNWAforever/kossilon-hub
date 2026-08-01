import { describe, expect, it } from "vitest";
import type { AnnualReturnCase } from "@/features/annual-return/types";
import { buildDailyDigest, digestTone } from "@/lib/daily-digest";

const NOW = new Date("2026-07-05T09:00:00+08:00");

function annualReturnCase(partial: Partial<AnnualReturnCase>): AnnualReturnCase {
  return {
    id: partial.id ?? "ar-test",
    companyId: partial.companyId ?? "company-test",
    companyTeamId: partial.companyTeamId ?? "team-a",
    companyName: partial.companyName ?? "Harbour Trading Ltd",
    returnYear: partial.returnYear ?? 2026,
    madeUpDate: partial.madeUpDate ?? "2026-06-01",
    filingDueDate: partial.filingDueDate ?? "2026-07-05",
    currentStatus: partial.currentStatus ?? "Documents pending",
    riskLevel: partial.riskLevel ?? "red",
    ownerId: partial.ownerId ?? "u-amy",
    ownerName: partial.ownerName ?? "Amy Chan",
    reviewerId: partial.reviewerId ?? null,
    reviewerName: partial.reviewerName ?? null,
    remindersSent: partial.remindersSent ?? 2,
    filingReference: partial.filingReference ?? null,
    confirmationDocumentId: partial.confirmationDocumentId ?? null,
    lockedAt: partial.lockedAt ?? null,
    completedAt: partial.completedAt ?? null,
    checklist: partial.checklist ?? [
      {
        id: "item-1",
        caseId: "ar-test",
        itemLabel: "Signed NAR1 form",
        required: true,
        status: "Missing",
        dueDate: "2026-07-05",
        receivedAt: null,
        verifiedAt: null,
        documentId: null,
      },
    ],
    payment: partial.payment ?? null,
  };
}

describe("daily AI digest", () => {
  it("prioritizes overdue annual returns", () => {
    const digest = buildDailyDigest({
      now: NOW,
      annualReturnCases: [
        annualReturnCase({
          id: "ar-critical",
          companyName: "Harbour Trading Ltd",
          filingDueDate: "2026-07-04",
          riskLevel: "red",
        }),
      ],
    });

    expect(digest.headline).toBe("1 priority action before close of business");
    expect(digest.counts).toEqual({ critical: 1, high: 0, medium: 0 });
    expect(digest.items.map((item) => item.id)).toEqual(["annual-return:ar-critical"]);
    expect(digest.items[0]).toMatchObject({
      kind: "annual-return",
      severity: "critical",
      title: "Escalate Harbour Trading Ltd annual return",
      actionLabel: "Open case",
      route: { to: "/annual-returns/$id", params: { id: "ar-critical" } },
    });
    expect(digestTone("critical")).toBe("red");
  });

  it("caps digest items while keeping the most urgent work first", () => {
    const digest = buildDailyDigest({
      now: NOW,
      maxItems: 2,
      annualReturnCases: [
        annualReturnCase({
          id: "ar-critical",
          companyName: "Critical Co Ltd",
          filingDueDate: "2026-07-04",
          riskLevel: "red",
        }),
        annualReturnCase({
          id: "ar-high",
          companyName: "High Co Ltd",
          filingDueDate: "2026-07-30",
          riskLevel: "yellow",
        }),
        annualReturnCase({
          id: "ar-medium",
          companyName: "Medium Co Ltd",
          filingDueDate: "2026-07-30",
          riskLevel: "yellow",
          checklist: [],
        }),
      ],
    });

    expect(digest.totalCandidateCount).toBe(3);
    expect(digest.items).toHaveLength(2);
    expect(digest.items.map((item) => item.id)).toEqual([
      "annual-return:ar-critical",
      "annual-return:ar-high",
    ]);
  });

  it("returns a calm headline when there is no priority work", () => {
    const digest = buildDailyDigest({
      now: NOW,
      annualReturnCases: [
        annualReturnCase({
          id: "ar-complete",
          currentStatus: "Completed",
          riskLevel: "green",
          filingDueDate: "2026-08-30",
          checklist: [],
        }),
      ],
    });

    expect(digest.headline).toBe("No priority actions detected");
    expect(digest.items).toEqual([]);
    expect(digest.counts).toEqual({ critical: 0, high: 0, medium: 0 });
  });
});
