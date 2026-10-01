import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AnnualReturnRepository } from "./repository";
import type { CaseHistoryEntry } from "./case-history";
import {
  addAnnualReturnCaseNoteForActor,
  assignAnnualReturnCaseOwnerForActor,
  listAnnualReturnCaseFindingsForActor,
  listAnnualReturnCaseHistoryForActor,
  resolveAnnualReturnCaseFindingForActor,
  listAnnualReturnCasePageForActor,
  getAnnualReturnBoardTotalsForActor,
  updateAnnualReturnStatusForActor,
  recordAnnualReturnPaymentEvidenceForActor,
  reviewAnnualReturnPaymentEvidenceForActor,
} from "./server-fns";
import { ReadinessConflictError } from "./readiness";

const caseId = "91000000-0000-0000-0000-000000000001";
const ownerId = "20000000-0000-0000-0000-000000000002";
const staffId = "20000000-0000-0000-0000-000000000001";

const clientActor: AuthenticatedActor = {
  authUserId: "client-auth",
  userId: null,
  role: "Client",
  teamId: null,
  active: true,
};

const staffActor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: staffId,
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};

describe("payment receipt command boundary", () => {
  const input = {
    caseId,
    paymentId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    proofVersionId: crypto.randomUUID(),
    expectedVersion: "a".repeat(32),
  };
  it("returns HTTP409 for stale record and review previews", async () => {
    const service = {
      record: vi.fn().mockRejectedValue(new ReadinessConflictError()),
      review: vi.fn().mockRejectedValue(new ReadinessConflictError()),
    };
    await expect(
      recordAnnualReturnPaymentEvidenceForActor(
        staffActor,
        { ...input, amount: "600", receivedOn: "2026-10-01" },
        service,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      reviewAnnualReturnPaymentEvidenceForActor(
        staffActor,
        { ...input, decision: "verified" },
        service,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("denies Client and inactive actors before invoking receipt writes", async () => {
    const service = { record: vi.fn(), review: vi.fn() };
    for (const actor of [clientActor, { ...staffActor, active: false }]) {
      await expect(
        recordAnnualReturnPaymentEvidenceForActor(
          actor,
          { ...input, amount: "600", receivedOn: "2026-10-01" },
          service,
        ),
      ).rejects.toThrow();
      await expect(
        reviewAnnualReturnPaymentEvidenceForActor(
          actor,
          { ...input, decision: "verified" },
          service,
        ),
      ).rejects.toThrow();
    }
    expect(service.record).not.toHaveBeenCalled();
    expect(service.review).not.toHaveBeenCalled();
  });
});

describe("readiness version command boundary", () => {
  it("passes the actual preview token and returns HTTP409 for transaction conflicts", async () => {
    const expectedVersion = "a".repeat(32);
    const updateStatus = vi.fn().mockRejectedValue(new ReadinessConflictError());
    const repository = {
      getCase: vi.fn(async () => ({
        id: caseId,
        companyTeamId: staffActor.teamId,
        ownerId: staffId,
        reviewerId: null,
        currentStatus: "Payment received",
      })),
      updateStatus,
    } as unknown as AnnualReturnRepository;
    await expect(
      updateAnnualReturnStatusForActor(
        staffActor,
        { caseId, nextStatus: "NAR1 prepared", expectedVersion },
        { repository },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(updateStatus).toHaveBeenCalledWith(caseId, "NAR1 prepared", staffId, expectedVersion);
  });
  it("denies foreign case before reading a command token or invoking a write", async () => {
    const updateStatus = vi.fn();
    const repository = {
      getCase: vi.fn(async () => ({
        id: caseId,
        companyTeamId: crypto.randomUUID(),
        ownerId: ownerId,
        reviewerId: null,
        currentStatus: "Payment received",
      })),
      updateStatus,
    } as unknown as AnnualReturnRepository;
    await expect(
      updateAnnualReturnStatusForActor(
        staffActor,
        { caseId, nextStatus: "NAR1 prepared", expectedVersion: "a".repeat(32) },
        { repository },
      ),
    ).rejects.toThrow("Forbidden");
    expect(updateStatus).not.toHaveBeenCalled();
  });
});

describe("origin diagnostics server authorization", () => {
  it("denies fixture widening before list/metric repository reads for non-Admin", async () => {
    const listCasePage = vi.fn();
    const boardTotals = vi.fn();
    await expect(
      listAnnualReturnCasePageForActor(
        staffActor,
        { includeFixtures: true },
        { repository: { listCasePage } },
      ),
    ).rejects.toThrow("Admin");
    await expect(
      getAnnualReturnBoardTotalsForActor(
        staffActor,
        { includeFixtures: true },
        { repository: { boardTotals } },
      ),
    ).rejects.toThrow("Admin");
    expect(listCasePage).not.toHaveBeenCalled();
    expect(boardTotals).not.toHaveBeenCalled();
  });
  it("passes explicit fixture diagnostics for active Admin while default excludes fixtures", async () => {
    const actor = { ...staffActor, role: "Admin" as const };
    const listCasePage = vi.fn(async () => ({ cases: [], nextCursor: null }));
    await listAnnualReturnCasePageForActor(
      actor,
      { includeFixtures: true },
      { repository: { listCasePage } },
    );
    expect(listCasePage).toHaveBeenLastCalledWith({ includeFixtures: true });
    await listAnnualReturnCasePageForActor(actor, {}, { repository: { listCasePage } });
    expect(listCasePage).toHaveBeenLastCalledWith({ includeFixtures: false });
  });
});

describe("annual return case command authorization", () => {
  it("rejects client owner assignment", async () => {
    const assignOwner = vi.fn();
    const dependencies = {
      repository: { assignOwner } as unknown as AnnualReturnRepository,
    };

    await expect(
      assignAnnualReturnCaseOwnerForActor(clientActor, { caseId, ownerId }, dependencies),
    ).rejects.toThrow(/staff access is required/i);
    expect(assignOwner).not.toHaveBeenCalled();
  });

  it("trims and persists a staff note", async () => {
    const addNote = vi.fn(async (input: { caseId: string; body: string; actorId: string }) => ({
      id: "95000000-0000-0000-0000-000000000001",
      caseId: input.caseId,
      authorId: input.actorId,
      body: input.body,
      createdAt: "2026-07-13T08:00:00.000Z",
    }));
    const dependencies = {
      repository: { addNote } as unknown as AnnualReturnRepository,
    };

    const note = await addAnnualReturnCaseNoteForActor(
      staffActor,
      { caseId, body: "  Ready for review.  " },
      dependencies,
    );

    expect(note.body).toBe("Ready for review.");
    expect(addNote).toHaveBeenCalledWith({
      caseId,
      body: "Ready for review.",
      actorId: staffId,
    });
  });

  const managerActor: AuthenticatedActor = {
    authUserId: "manager-auth",
    userId: "20000000-0000-0000-0000-000000000009",
    role: "Manager",
    teamId: "10000000-0000-0000-0000-000000000099",
    active: true,
  };

  const visibleCase = {
    id: caseId,
    companyName: "Acme Company Limited",
    companyTeamId: staffActor.teamId!,
    ownerId: staffActor.userId!,
    reviewerId: null,
  };

  it("rejects a history read for a case outside the actor's scope", async () => {
    const getCase = vi.fn(async () => ({
      ...visibleCase,
      companyTeamId: managerActor.teamId!,
      ownerId: managerActor.userId!,
    }));
    const listAuditEventsForCase = vi.fn();
    const listAssignmentEventsForCase = vi.fn();
    const dependencies = {
      repository: {
        getCase,
        listAuditEventsForCase,
        listAssignmentEventsForCase,
      } as unknown as AnnualReturnRepository,
    };

    await expect(
      listAnnualReturnCaseHistoryForActor(staffActor, { caseId }, dependencies),
    ).rejects.toThrow(/outside your scope/i);
    expect(listAuditEventsForCase).not.toHaveBeenCalled();
    expect(listAssignmentEventsForCase).not.toHaveBeenCalled();
  });

  it("throws when the case does not exist", async () => {
    const getCase = vi.fn(async () => null);
    const dependencies = {
      repository: {
        getCase,
        listAuditEventsForCase: vi.fn(),
        listAssignmentEventsForCase: vi.fn(),
      } as unknown as AnnualReturnRepository,
    };

    await expect(
      listAnnualReturnCaseHistoryForActor(staffActor, { caseId }, dependencies),
    ).rejects.toThrow(/not found/i);
  });

  it("returns the merged history for a visible case", async () => {
    const getCase = vi.fn(async () => visibleCase);
    const listAuditEventsForCase = vi.fn(async () => [
      {
        id: "a1000000-0000-0000-0000-000000000001",
        actor_id: staffActor.userId,
        actor_name: "Amy Chan",
        actor_role: "Staff" as const,
        action: "add_note" as const,
        result: "succeeded" as const,
        summary: "Note added.",
        metadata: {},
        created_at: "2026-08-01T09:00:00.000Z",
      },
    ]);
    const listAssignmentEventsForCase = vi.fn(async () => []);
    const dependencies = {
      repository: {
        getCase,
        listAuditEventsForCase,
        listAssignmentEventsForCase,
      } as unknown as AnnualReturnRepository,
    };

    const history: CaseHistoryEntry[] = await listAnnualReturnCaseHistoryForActor(
      staffActor,
      { caseId },
      dependencies,
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "audit", action: "add_note" });
    expect(listAuditEventsForCase).toHaveBeenCalledWith(caseId);
    expect(listAssignmentEventsForCase).toHaveBeenCalledWith(caseId);
  });
});

describe("case findings authorization", () => {
  const inspectedVersionId = "71000000-0000-4000-8000-000000000001";
  const visibleCase = {
    id: caseId,
    companyTeamId: staffActor.teamId,
    ownerId: staffId,
    reviewerId: null,
  };

  function dependenciesFor(
    overrides: {
      getCase?: () => Promise<unknown>;
      resolveFinding?: (input: {
        findingId: string;
        caseId: string;
        resolvedByUserId: string;
        note: string | null;
      }) => Promise<boolean>;
    } = {},
  ) {
    return {
      repository: {
        getCase: overrides.getCase ?? vi.fn(async () => visibleCase),
      } as unknown as AnnualReturnRepository,
      analysis: {
        listFindingsForCase: vi.fn(async () => []),
        resolveFinding: overrides.resolveFinding ?? vi.fn(async () => true),
      },
    };
  }

  // Findings quote a document's own text, so reaching them at all is a decision
  // about who may read the case.
  it("does not read findings for a case the actor cannot see", async () => {
    const dependencies = dependenciesFor({
      getCase: vi.fn(async () => ({
        id: caseId,
        companyTeamId: "40000000-0000-0000-0000-000000000009",
        ownerId: "40000000-0000-0000-0000-00000000000a",
        reviewerId: null,
      })),
    });

    await expect(
      listAnnualReturnCaseFindingsForActor(staffActor, { caseId }, dependencies),
    ).rejects.toThrow();
    expect(dependencies.analysis.listFindingsForCase).not.toHaveBeenCalled();
  });

  it("does not touch the analysis repository when the case does not exist", async () => {
    const dependencies = dependenciesFor({ getCase: vi.fn(async () => null) });
    await expect(
      listAnnualReturnCaseFindingsForActor(staffActor, { caseId }, dependencies),
    ).rejects.toThrow(/not found/i);
    expect(dependencies.analysis.listFindingsForCase).not.toHaveBeenCalled();
  });

  /**
   * A resolution is the record of who decided. A client has no staff user row,
   * so letting one through would either violate the resolved_by/resolved_at
   * constraint or record a decision attributable to nobody.
   */
  it("refuses a resolution from an actor with no staff identity", async () => {
    const dependencies = dependenciesFor();
    await expect(
      resolveAnnualReturnCaseFindingForActor(
        clientActor,
        {
          caseId,
          findingId: "50000000-0000-0000-0000-000000000001",
          note: null,
          expectedDocumentVersionId: inspectedVersionId,
        },
        dependencies,
      ),
    ).rejects.toThrow(/staff access is required/i);
    expect(dependencies.analysis.resolveFinding).not.toHaveBeenCalled();
  });

  // Never from the caller. The whole value of the field is that it names the
  // person the request was authenticated as.
  it("takes the resolving user from the actor, and scopes the write to the case", async () => {
    const resolveFinding = vi.fn(async () => true);
    const dependencies = dependenciesFor({ resolveFinding });

    await resolveAnnualReturnCaseFindingForActor(
      staffActor,
      {
        caseId,
        findingId: "50000000-0000-0000-0000-000000000001",
        note: "Checked by hand.",
        expectedDocumentVersionId: inspectedVersionId,
      },
      dependencies,
    );

    expect(resolveFinding).toHaveBeenCalledWith({
      findingId: "50000000-0000-0000-0000-000000000001",
      caseId,
      resolvedByUserId: staffId,
      note: "Checked by hand.",
      resolvedByAuthUserId: staffActor.authUserId,
      expectedDocumentVersionId: inspectedVersionId,
    });
  });

  // Somebody else got there first, or it belongs to another case. Reported, not
  // thrown: the reviewer's intent is satisfied either way and the refreshed list
  // shows whose decision stands.
  it("reports rather than throws when the write matched nothing", async () => {
    const dependencies = dependenciesFor({ resolveFinding: vi.fn(async () => false) });
    await expect(
      resolveAnnualReturnCaseFindingForActor(
        staffActor,
        {
          caseId,
          findingId: "50000000-0000-0000-0000-000000000001",
          note: null,
          expectedDocumentVersionId: inspectedVersionId,
        },
        dependencies,
      ),
    ).resolves.toEqual({ applied: false });
  });
});
