import { describe, expect, it, vi } from "vitest";

import {
  getClientPortalCaseForActor,
  listClientPortalCasesForActor,
} from "./client-portal-server-fns";
import type { AnnualReturnCase } from "./types";

const COMPANY_A = "aa000000-0000-4000-8000-000000000001";
const COMPANY_B = "bb000000-0000-4000-8000-000000000002";
const CASE_A = "11000000-0000-4000-8000-000000000001";

function caseRecord(overrides: Partial<AnnualReturnCase> = {}): AnnualReturnCase {
  return {
    id: CASE_A,
    companyId: COMPANY_A,
    companyTeamId: "team-1",
    companyName: "Harbour Holdings Limited",
    returnYear: 2026,
    madeUpDate: "2026-03-31",
    filingDueDate: "2026-05-12",
    currentStatus: "Documents pending",
    riskLevel: "yellow",
    ownerId: "owner-1",
    ownerName: "Amy Chan",
    reviewerId: null,
    reviewerName: null,
    remindersSent: 0,
    filingReference: null,
    confirmationDocumentId: null,
    lockedAt: null,
    completedAt: null,
    checklist: [
      {
        id: "item-1",
        caseId: CASE_A,
        itemLabel: "Signed NAR1",
        required: true,
        status: "Missing",
        dueDate: "2026-05-01",
        receivedAt: null,
        verifiedAt: null,
        documentId: null,
      },
      {
        id: "item-2",
        caseId: CASE_A,
        itemLabel: "Register extract",
        required: true,
        status: "Verified",
        dueDate: "2026-05-01",
        receivedAt: "2026-04-01T00:00:00.000Z",
        verifiedAt: "2026-04-02T00:00:00.000Z",
        documentId: "doc-1",
      },
    ],
    payment: {
      id: "pay-1",
      caseId: CASE_A,
      invoiceNumber: "INV-1",
      amount: 1200,
      currency: "HKD",
      status: "Payment pending",
      dueDate: "2026-05-01",
      paidAt: null,
      paymentProofDocumentId: null,
    },
    ...overrides,
  } as AnnualReturnCase;
}

function dependencies(companyIds: string[], cases: AnnualReturnCase[] = [caseRecord()]) {
  const listCases = vi.fn(async () => cases);
  return {
    listCases,
    deps: {
      repository: { listCases },
      listCompanyIds: vi.fn(async () => companyIds),
    },
  };
}

/**
 * Every other read in this feature resolves a staff actor, so a Client sign-in was
 * refused everywhere and the portal — the one surface built for them — had no route
 * to a case id. Scope comes from client_company_memberships and nothing else: a
 * caller cannot name a company, so there is no id to tamper with.
 */
describe("listClientPortalCasesForActor", () => {
  it("returns the client's own cases as summaries", async () => {
    const { deps, listCases } = dependencies([COMPANY_A]);

    await expect(listClientPortalCasesForActor(deps)).resolves.toEqual([
      expect.objectContaining({
        id: CASE_A,
        companyName: "Harbour Holdings Limited",
        outstandingRequiredItems: 1,
        paymentStatus: "Payment pending",
      }),
    ]);
    expect(listCases).toHaveBeenCalledWith({ companyIds: [COMPANY_A] });
  });

  // An empty membership list must not become an unscoped read.
  it("returns nothing, and queries nothing, when the client has no memberships", async () => {
    const { deps, listCases } = dependencies([]);

    await expect(listClientPortalCasesForActor(deps)).resolves.toEqual([]);
    expect(listCases).not.toHaveBeenCalled();
  });

  it("scopes to every company the client belongs to", async () => {
    const { deps, listCases } = dependencies([COMPANY_A, COMPANY_B]);

    await listClientPortalCasesForActor(deps);

    expect(listCases).toHaveBeenCalledWith({ companyIds: [COMPANY_A, COMPANY_B] });
  });
});

describe("getClientPortalCaseForActor", () => {
  it("returns a case belonging to the client's company", async () => {
    const { deps } = dependencies([COMPANY_A]);

    await expect(getClientPortalCaseForActor({ caseId: CASE_A }, deps)).resolves.toMatchObject({
      id: CASE_A,
    });
  });

  /**
   * AnnualReturnCase is the internal staff record. An earlier version returned it
   * whole because the staff detail view happened to take the same type, handing
   * the client the firm's own assignment and risk grading of their file.
   */
  it("never exposes the firm's internal handling of the case", async () => {
    const { deps } = dependencies([COMPANY_A]);

    const detail = await getClientPortalCaseForActor({ caseId: CASE_A }, deps);

    for (const leaked of [
      "ownerId",
      "ownerName",
      "reviewerId",
      "reviewerName",
      "riskLevel",
      "companyTeamId",
      "lockedAt",
    ]) {
      expect(detail, `client detail leaks ${leaked}`).not.toHaveProperty(leaked);
    }
  });

  it("still gives the client what their own filing needs", async () => {
    const { deps } = dependencies([COMPANY_A]);

    const detail = await getClientPortalCaseForActor({ caseId: CASE_A }, deps);

    expect(detail).toMatchObject({
      companyName: "Harbour Holdings Limited",
      returnYear: 2026,
      filingDueDate: "2026-05-12",
      currentStatus: "Documents pending",
    });
    expect(detail?.checklist).toHaveLength(2);
    expect(detail?.payment).toMatchObject({ status: "Payment pending" });
  });

  it("keeps the checklist free of internal document ids", async () => {
    const { deps } = dependencies([COMPANY_A]);

    const detail = await getClientPortalCaseForActor({ caseId: CASE_A }, deps);

    for (const item of detail?.checklist ?? []) {
      expect(item).not.toHaveProperty("documentId");
      expect(item).not.toHaveProperty("verifiedAt");
    }
  });

  it("returns null for a case outside the client's companies", async () => {
    const { deps } = dependencies([COMPANY_A], []);

    await expect(getClientPortalCaseForActor({ caseId: CASE_A }, deps)).resolves.toBeNull();
  });

  it("does not read at all when the client has no memberships", async () => {
    const { deps, listCases } = dependencies([]);

    await expect(getClientPortalCaseForActor({ caseId: CASE_A }, deps)).resolves.toBeNull();
    expect(listCases).not.toHaveBeenCalled();
  });

  // The lookup is a membership-filtered query, not a fetch-by-id followed by a
  // check, so an out-of-scope case is never loaded in the first place.
  it("filters by membership rather than checking after the fetch", async () => {
    const { deps, listCases } = dependencies([COMPANY_A]);

    await getClientPortalCaseForActor({ caseId: CASE_A }, deps);

    expect(listCases).toHaveBeenCalledWith({ companyIds: [COMPANY_A] });
  });
});
