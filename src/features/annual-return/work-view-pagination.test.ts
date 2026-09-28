import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportPreviewPage } from "@/features/nar-import/components/import-preview-page";
import type { ImportPreviewRow } from "@/features/nar-import/preview";
import type { AuthenticatedActor } from "@/features/auth/types";
import { listWorkViewForActor, getOperationalMetricsForActor } from "./server-fns";
import type { CaseSubmissionReadiness } from "./submission-readiness-service";

const actor: AuthenticatedActor = {
  authUserId: "auth-staff",
  userId: "11111111-1111-4111-8111-111111111111",
  role: "Staff",
  teamId: "22222222-2222-4222-8222-222222222222",
  active: true,
};
const asOf = "2026-09-28";

describe("T27 work-view pagination", () => {
  it("t27_scenario_1: 1k, 10k and over 20k totals stay accurate without scanning every case", async () => {
    for (const total of [1_000, 10_000, 20_001]) {
      const listAllCases = vi.fn(() => {
        throw new Error("full case scan is forbidden");
      });
      const listWorkViewPage = vi.fn(
        async (_input: {
          scope: { teamId?: string; visibleToUserId?: string };
          limit: number;
          cursor?: string;
        }) => ({
          definition: {
            key: "chaseToday" as const,
            label: "今日要追",
            description: "",
            released: true,
          },
          rows: [
            {
              caseId: "33333333-3333-4333-8333-333333333333",
              companyName: "Deep page",
              returnYear: 2026,
              filingDueDate: "2026-10-01",
              daysRemaining: 3,
              ownerName: "Ada",
              blocker: "文件",
            },
          ],
          total,
          nextCursor: "next-page",
          asOf,
        }),
      );
      const page = await listWorkViewForActor(
        actor,
        { view: "chaseToday", cursor: "deep-page", limit: 50, asOf },
        { repository: { listWorkViewPage, listAllCases } },
      );
      expect(page.total).toBe(total);
      expect(page.rows).toHaveLength(1);
      expect(page.nextCursor).toBe("next-page");
      expect(listAllCases).not.toHaveBeenCalled();
      expect(listWorkViewPage).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { teamId: actor.teamId, visibleToUserId: actor.userId },
          limit: 50,
          cursor: "deep-page",
          asOf,
        }),
      );
    }
  });

  it("t03_ready_queue releases only verified candidates and never reports candidate count as ready", async () => {
    const readyId = "33333333-3333-4333-8333-333333333333";
    const unreadableId = "44444444-4444-4444-8444-444444444444";
    const row = (caseId: string) => ({
      caseId,
      companyName: "Scoped company",
      returnYear: 2026,
      filingDueDate: "2026-10-01",
      daysRemaining: 3,
      ownerName: "Ada",
      blocker: "待核實",
    });
    const listAllCases = vi.fn(() => {
      throw new Error("full case scan is forbidden");
    });
    const listWorkViewPage = vi.fn(async () => ({
      definition: {
        key: "readyToFile" as const,
        label: "可以交件",
        description: "",
        released: false,
      },
      rows: [row(readyId), row(unreadableId)],
      total: 20_001,
      nextCursor: "next-candidate-page",
      asOf,
    }));
    const inspectSubmission = vi.fn(
      async (_actor: AuthenticatedActor, caseId: string): Promise<CaseSubmissionReadiness> =>
        caseId === readyId
          ? {
              state: "ready",
              packageId: "approved-package",
              revision: 1,
              manifestHash: "verified-hash",
              readiness: {
                documentsComplete: true,
                paymentConfirmed: true,
                canApprovePackage: true,
                canRecordSubmission: true,
                canComplete: false,
                blockers: [],
                snapshotRevision: 1,
              },
            }
          : { state: "unknown", reason: "package-unverifiable" },
    );
    const page = await listWorkViewForActor(
      actor,
      { view: "readyToFile", limit: 50, asOf },
      { repository: { listWorkViewPage, listAllCases }, inspectSubmission },
    );
    expect(page.definition.released).toBe(true);
    expect(page.rows.map((item) => item.caseId)).toEqual([readyId]);
    expect(page.total).toBeNull();
    expect(page.nextCursor).toBe("next-candidate-page");
    expect(page.unverifiedCount).toBe(1);
    expect(inspectSubmission).toHaveBeenCalledWith(actor, readyId);
    expect(inspectSubmission).toHaveBeenCalledWith(actor, unreadableId);
    expect(listAllCases).not.toHaveBeenCalled();
  });

  it("t03_ready_queue bounds storage verification to four concurrent cases", async () => {
    let active = 0;
    let peak = 0;
    const rows = Array.from({ length: 9 }, (_, index) => ({
      caseId: String(index + 1),
      companyName: "Scoped",
      returnYear: 2026,
      filingDueDate: asOf,
      daysRemaining: 0,
      ownerName: "Ada",
      blocker: "candidate",
    }));
    const listWorkViewPage = vi.fn(async () => ({
      definition: {
        key: "readyToFile" as const,
        label: "可以交件",
        description: "",
        released: false,
      },
      rows,
      total: rows.length,
      nextCursor: null,
      asOf,
    }));
    const inspectSubmission = vi.fn(async (): Promise<CaseSubmissionReadiness> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { state: "blocked", reason: "package-missing" };
    });
    const page = await listWorkViewForActor(
      actor,
      { view: "readyToFile", asOf },
      {
        repository: { listWorkViewPage },
        inspectSubmission,
      },
    );
    expect(peak).toBe(4);
    expect(page.rows).toEqual([]);
    expect(inspectSubmission).toHaveBeenCalledTimes(9);
  });

  it("t27_scenario_2: a 10k-row monthly preview renders only one 50-row DOM page", async () => {
    const rows: ImportPreviewRow[] = Array.from({ length: 10_000 }, (_, index) => ({
      rowId: `row-${index + 1}`,
      rowRevision: 1,
      rowNumber: index + 1,
      externalClientId: `CLIENT-${index + 1}`,
      matchedCompanyId: null,
      matchedCaseId: null,
      caseSnapshot: null,
      disposition: "unchanged",
      issues: [],
      fields: [],
    }));
    const labels = {
      new: "new",
      updated: "updated",
      unchanged: "unchanged",
      conflict: "conflict",
      invalid: "invalid",
      needsCompanyMapping: "mapping",
    };
    const first = renderToStaticMarkup(createElement(ImportPreviewPage, { rows, page: 0, labels }));
    const last = renderToStaticMarkup(
      createElement(ImportPreviewPage, { rows, page: 199, labels }),
    );
    expect(first.match(/data-import-preview-row/g)).toHaveLength(50);
    expect(last.match(/data-import-preview-row/g)).toHaveLength(50);
    expect(first).toContain("CLIENT-1");
    expect(last).toContain("CLIENT-10000");
    expect(last).not.toContain("CLIENT-1 .");

    const { readFileSync } = await import("node:fs");
    const route = readFileSync(new URL("../../routes/imports.tsx", import.meta.url), "utf8");
    expect(route).toContain("limit: 50");
    expect(route).toContain("limit: 20");
    expect(route).toContain("reviewCursor");
    expect(route).toContain("companyCursor");
  });

  it("t27_scenario_3: operational summary uses the same asOf and actor scope without provider reads", async () => {
    const listAllCases = vi.fn(() => {
      throw new Error("full case scan is forbidden");
    });
    const operationalMetrics = vi.fn(async () => ({
      activeCases: 20_001,
      overdueCases: 300,
      missingEvidenceCases: 500,
      missingEvidenceItems: 700,
      paymentPendingCases: 400,
      assignedToMe: 99,
      scopeLabel: "可見案件",
      asOf,
    }));
    const result = await getOperationalMetricsForActor(
      actor,
      { asOf },
      { repository: { operationalMetrics, listAllCases } },
    );
    expect(result.activeCases).toBe(20_001);
    expect(result.asOf).toBe(asOf);
    expect(operationalMetrics).toHaveBeenCalledWith(
      { teamId: actor.teamId, visibleToUserId: actor.userId },
      asOf,
      actor.userId,
    );
    expect(listAllCases).not.toHaveBeenCalled();
  });
});
