import { describe, expect, it } from "vitest";
import type { DashboardCase } from "@/features/dashboard/types";
import { buildDailyDigest, digestTone } from "@/lib/daily-digest";

const NOW = new Date("2026-07-05T09:00:00+08:00");

function annualReturnCase(partial: Partial<DashboardCase>): DashboardCase {
  return {
    id: partial.id ?? "ar-test",
    companyName: partial.companyName ?? "Harbour Trading Ltd",
    filingDueDate: partial.filingDueDate ?? "2026-07-05",
    currentStatus: partial.currentStatus ?? "Documents pending",
    riskLevel: partial.riskLevel ?? "red",
    ownerName: partial.ownerName ?? "Amy Chan",
    checklist: partial.checklist ?? [{ required: true, status: "Missing" }],
    payment: partial.payment ?? null,
    filingReference: partial.filingReference ?? null,
    confirmationDocumentId: partial.confirmationDocumentId ?? null,
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

    expect(digest.headline).toBe("今日下班前有 1 項優先工作");
    expect(digest.counts).toEqual({ critical: 1, high: 0, medium: 0 });
    expect(digest.items.map((item) => item.id)).toEqual(["annual-return:ar-critical"]);
    expect(digest.items[0]).toMatchObject({
      kind: "annual-return",
      severity: "critical",
      title: "升級處理 Harbour Trading Ltd 的周年申報",
      actionLabel: "開啟案件",
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

    expect(digest.headline).toBe("未發現需優先處理的工作");
    expect(digest.items).toEqual([]);
    expect(digest.counts).toEqual({ critical: 0, high: 0, medium: 0 });
  });
});

describe("daily AI digest during the Hong Kong overnight window", () => {
  // 00:30 in Hong Kong is still the previous UTC day. Every day count the
  // digest renders has to come from the firm's calendar day, not the runtime's,
  // or the first staff to open the dashboard each morning is told a case due
  // today is due tomorrow — and an overdue one merely due today.
  const OVERNIGHT = new Date("2026-07-05T00:30:00+08:00");

  it("reads a case due on the Hong Kong date as due today", () => {
    const digest = buildDailyDigest({
      now: OVERNIGHT,
      annualReturnCases: [annualReturnCase({ id: "ar-today", filingDueDate: "2026-07-05" })],
    });

    expect(digest.items[0].detail).toContain("今日到期");
  });

  it("reads a case due yesterday as overdue", () => {
    const digest = buildDailyDigest({
      now: OVERNIGHT,
      annualReturnCases: [annualReturnCase({ id: "ar-late", filingDueDate: "2026-07-04" })],
    });

    expect(digest.items[0].detail).toContain("已逾期 1 日");
    expect(digest.items[0].severity).toBe("critical");
  });

  it("scores an overdue case above one due today", () => {
    const digest = buildDailyDigest({
      now: OVERNIGHT,
      annualReturnCases: [
        annualReturnCase({ id: "ar-today", companyName: "A Co", filingDueDate: "2026-07-05" }),
        annualReturnCase({ id: "ar-late", companyName: "B Co", filingDueDate: "2026-07-04" }),
      ],
    });

    expect(digest.items.map((item) => item.id)).toEqual([
      "annual-return:ar-late",
      "annual-return:ar-today",
    ]);
  });
});
