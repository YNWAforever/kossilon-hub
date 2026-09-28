import type postgres from "postgres";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentStorage } from "@/features/documents/types";
import { entityIdSchema } from "@/features/runtime/entity-id";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import { downloadApprovedPackageForActor, getPackageForActor } from "./package-service";
import { assertAnnualReturnActionAllowed, type AnnualReturnActorRole } from "./permissions";
import { createAnnualReturnRepository } from "./repository";

type Db = SqlClient | postgres.TransactionSql;

export type CaseSubmissionReadiness =
  | { state: "ready"; packageId: string; revision: number; manifestHash: string }
  | {
      state: "blocked";
      reason: "case-closed" | "package-missing" | "package-unapproved" | "existing-handoff";
    }
  | { state: "unknown"; reason: "package-unverifiable" };

export async function inspectCaseSubmissionReadinessForActor(
  actor: AuthenticatedActor,
  caseId: string,
  dependencies: { sql?: Db; storage: DocumentStorage },
): Promise<CaseSubmissionReadiness> {
  entityIdSchema.parse(caseId);
  const db = dependencies.sql ?? getSqlClient();
  const work = async (tx: Db): Promise<CaseSubmissionReadiness> => {
    // The package reader performs the current staff and case visibility checks.
    const currentPackage = await getPackageForActor(actor, caseId, {
      sql: tx,
      storage: dependencies.storage,
    });
    const repository = createAnnualReturnRepository({ sql: tx });
    try {
      const caseItem = await repository.getCase(caseId);
      if (!caseItem) throw new Error("Annual return case not found.");
      if (
        caseItem.lockedAt ||
        caseItem.completedAt ||
        caseItem.currentStatus === "Filed" ||
        caseItem.currentStatus === "Completed"
      ) {
        return { state: "blocked", reason: "case-closed" };
      }
      if (!currentPackage) return { state: "blocked", reason: "package-missing" };
      if (currentPackage.state !== "approved") {
        return { state: "blocked", reason: "package-unapproved" };
      }

      const staff = assertStaffAccess(actor);
      if (!staff.userId) throw new Error("Forbidden: staff database identity is required.");
      const [currentActor] = await tx<
        { id: string; role: AnnualReturnActorRole; team_id: string | null; active: boolean }[]
      >`
        select id, role, team_id, active from users where id = ${staff.userId} limit 1
      `;
      if (!currentActor) throw new Error("Annual return actor not found.");
      assertAnnualReturnActionAllowed(
        {
          id: currentActor.id,
          role: currentActor.role,
          teamId: currentActor.team_id,
          active: currentActor.active,
        },
        {
          id: caseItem.id,
          companyName: caseItem.companyName,
          companyTeamId: caseItem.companyTeamId,
          ownerId: caseItem.ownerId,
          reviewerId: caseItem.reviewerId,
        },
        "record_submission",
      );
    } finally {
      await repository.close();
    }

    const [existing] = await tx<{ id: string }[]>`
      select id from package_handoffs
      where case_id = ${caseId}
        and status in ('prepared', 'recorded_submission', 'transmitted', 'acknowledged')
      limit 1
    `;
    if (existing) return { state: "blocked", reason: "existing-handoff" };

    // Reuse the same manifest, payment, version, scanner and stored-byte checks
    // enforced by the download and manual-submission paths. Any uncertainty
    // blocks the UI; the mutation still revalidates in its own transaction.
    try {
      await downloadApprovedPackageForActor(actor, currentPackage.id, {
        sql: tx,
        storage: dependencies.storage,
      });
    } catch {
      return { state: "unknown", reason: "package-unverifiable" };
    }
    return {
      state: "ready",
      packageId: currentPackage.id,
      revision: currentPackage.revision,
      manifestHash: currentPackage.manifestHash,
    };
  };

  return "begin" in db
    ? (db.begin(
        "isolation level repeatable read read only",
        work,
      ) as Promise<CaseSubmissionReadiness>)
    : work(db);
}
