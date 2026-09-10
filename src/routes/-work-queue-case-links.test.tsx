import { describe, expect, it } from "vitest";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import { caseDetailLinkFor } from "./work-queue";

function makeItem(overrides: Partial<PersistedWorkItem> = {}): PersistedWorkItem {
  return {
    id: "wi-1",
    companyId: "company-1",
    companyName: "Acme Company Limited",
    ownerName: null,
    caseType: "annual_return",
    annualReturnCaseId: "case-1",
    corporateChangeRequestId: null,
    sourceEventKey: "event:wi-1",
    sourceEventType: "annual_return_case_created",
    workType: "annual_return_case",
    requiredSkillKey: null,
    title: "Set up new annual return case",
    status: "open",
    escalationState: "none",
    priority: 50,
    ownerId: null,
    reviewerId: null,
    teamId: null,
    slaPolicyVersionId: "policy-1",
    slaStartedAt: "2026-07-01T00:00:00.000Z",
    slaWarningAt: "2026-07-01T01:00:00.000Z",
    slaDueAt: "2026-07-01T03:00:00.000Z",
    slaBreachedAt: null,
    version: 1,
    completedAt: null,
    ...overrides,
  };
}

describe("caseDetailLinkFor", () => {
  it("links an annual_return work item to its case detail route", () => {
    expect(caseDetailLinkFor(makeItem())).toEqual({
      to: "/annual-returns/$id",
      params: { id: "case-1" },
    });
  });

  it("returns null when the work item has no case id yet", () => {
    expect(caseDetailLinkFor(makeItem({ annualReturnCaseId: null }))).toBeNull();
  });

  it("links a corporate_change_request work item to its request detail route", () => {
    expect(
      caseDetailLinkFor(
        makeItem({
          caseType: "corporate_change_request",
          annualReturnCaseId: null,
          corporateChangeRequestId: "request-1",
        }),
      ),
    ).toEqual({
      to: "/corporate-changes/$id",
      params: { id: "request-1" },
    });
  });

  it("returns null for a corporate_change_request work item with no case id yet", () => {
    expect(
      caseDetailLinkFor(
        makeItem({
          caseType: "corporate_change_request",
          annualReturnCaseId: null,
          corporateChangeRequestId: null,
        }),
      ),
    ).toBeNull();
  });
});
