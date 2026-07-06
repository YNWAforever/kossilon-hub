import { describe, expect, it } from "vitest";
import type { AnnualReturnCase } from "@/features/annual-return/types";
import type { Enquiry, Task } from "@/lib/mock-data";
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

function task(partial: Partial<Task>): Task {
  return {
    id: partial.id ?? "task-test",
    title: partial.title ?? "Chase director signature",
    companyName: partial.companyName ?? "Harbour Trading Ltd",
    dueDate: partial.dueDate ?? "2026-07-05T09:00:00.000Z",
    priority: partial.priority ?? "High",
    assigneeId: partial.assigneeId ?? "u-amy",
    done: partial.done ?? false,
  };
}

function enquiry(partial: Partial<Enquiry>): Enquiry {
  return {
    id: partial.id ?? "enquiry-test",
    contactName: partial.contactName ?? "Ada Director",
    phone: partial.phone ?? "+852 9000 0000",
    lastMessage: partial.lastMessage ?? "NAR1 deadline is tomorrow and signature is missing.",
    lastMessageAt: partial.lastMessageAt ?? "2026-07-05T08:00:00.000Z",
    intent: partial.intent ?? "Annual Return",
    intentConfidence: partial.intentConfidence ?? 0.82,
    quoteStatus: partial.quoteStatus ?? "None",
    assignedTo: partial.assignedTo,
    unread: partial.unread ?? 2,
    messages: partial.messages ?? [],
  };
}

describe("daily AI digest", () => {
  it("prioritizes overdue annual returns, urgent enquiries, and due high-priority tasks", () => {
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
      enquiries: [
        enquiry({
          id: "e-urgent",
          contactName: "Ada Director",
          lastMessage: "NAR1 deadline is tomorrow and signature is missing. Any penalty?",
        }),
      ],
      tasks: [
        task({
          id: "task-high",
          title: "Chase director signature",
          dueDate: "2026-07-05T11:00:00.000Z",
          priority: "High",
        }),
      ],
    });

    expect(digest.headline).toBe("3 priority actions before close of business");
    expect(digest.counts).toEqual({ critical: 1, high: 2, medium: 0 });
    expect(digest.items.map((item) => item.id)).toEqual([
      "annual-return:ar-critical",
      "enquiry:e-urgent",
      "task:task-high",
    ]);
    expect(digest.items[0]).toMatchObject({
      kind: "annual-return",
      severity: "critical",
      title: "Escalate Harbour Trading Ltd annual return",
      actionLabel: "Open case",
      route: { to: "/annual-returns/$id", params: { id: "ar-critical" } },
    });
    expect(digest.items[1]).toMatchObject({
      kind: "enquiry",
      severity: "high",
      title: "Review Ada Director WhatsApp reply",
      actionLabel: "Open enquiry",
      route: { to: "/enquiries", search: { enquiry: "e-urgent" } },
    });
    expect(digest.items[2]).toMatchObject({
      kind: "task",
      severity: "high",
      title: "Chase director signature",
      actionLabel: "Open tasks",
      route: { to: "/tasks" },
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
          id: "ar-medium",
          companyName: "Medium Co Ltd",
          filingDueDate: "2026-07-30",
          riskLevel: "yellow",
        }),
      ],
      enquiries: [
        enquiry({
          id: "e-urgent",
          lastMessage: "NAR1 filing deadline is today and documents are missing.",
        }),
      ],
      tasks: [
        task({
          id: "task-overdue",
          title: "Follow up payment proof",
          dueDate: "2026-07-04T11:00:00.000Z",
          priority: "High",
        }),
      ],
    });

    expect(digest.items).toHaveLength(2);
    expect(digest.items.map((item) => item.id)).toEqual([
      "annual-return:ar-critical",
      "enquiry:e-urgent",
    ]);
    expect(digest.totalCandidateCount).toBe(4);
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
      enquiries: [
        enquiry({
          id: "e-routine",
          lastMessage: "What is the price for opening a new HK company?",
          unread: 0,
        }),
      ],
      tasks: [
        task({
          id: "task-done",
          done: true,
        }),
      ],
    });

    expect(digest.headline).toBe("No priority actions detected");
    expect(digest.items).toEqual([]);
    expect(digest.counts).toEqual({ critical: 0, high: 0, medium: 0 });
  });
});
