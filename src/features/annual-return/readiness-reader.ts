import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentStorage } from "@/features/documents/types";
import { entityIdSchema } from "@/features/runtime/entity-id";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import {
  getPackageForActor,
  inspectApprovedPackageForActor,
  inspectCurrentDocumentManifestForActor,
  inspectCurrentPackageSnapshotForActor,
  inspectVerifiedPaymentForActor,
} from "./package-service";
import { assertProofCurrentAndSafe } from "./submission-service";
import { verifyInternalSourceObject } from "./return-service";
import { createAnnualReturnRepository } from "./repository";
import { completionBlockers } from "./workflow";
import {
  evaluateCaseReadiness,
  type CaseReadinessSnapshot,
  type EvidenceReadState,
  type ReadinessResult,
} from "./readiness";
import type { ManifestResult } from "./package-manifest";

type Db = SqlClient | postgres.TransactionSql;

export type CaseReadinessRead = {
  snapshot: CaseReadinessSnapshot;
  readiness: ReadinessResult;
};

/** All database facts come from one read-only snapshot; storage bytes are checked anew. */
export async function inspectCaseReadinessForActor(
  actor: AuthenticatedActor,
  caseId: string,
  dependencies: { sql?: Db; storage: DocumentStorage },
): Promise<CaseReadinessRead> {
  entityIdSchema.parse(caseId);
  const db = dependencies.sql ?? getSqlClient();
  const work = async (tx: Db): Promise<CaseReadinessRead> => {
    const packageDeps = { sql: tx, storage: dependencies.storage };
    // Checks the live staff profile and current case visibility before any facts are returned.
    const latest = await getPackageForActor(actor, caseId, packageDeps);
    const repository = createAnnualReturnRepository({ sql: tx });
    let caseItem;
    try {
      caseItem = await repository.getCase(caseId);
    } finally {
      await repository.close();
    }
    if (!caseItem) throw new Error("Annual return case not found.");

    let manifestResult: ManifestResult = { kind: "blocked", blockers: [] };
    let requiredEvidenceState: EvidenceReadState = "unknown";
    let paymentEvidenceState: EvidenceReadState = "unknown";
    let currentManifestHash: string | null = null;
    try {
      const documentManifest = await inspectCurrentDocumentManifestForActor(
        actor,
        caseId,
        packageDeps,
      );
      manifestResult = { kind: "releasable", manifest: documentManifest };
      requiredEvidenceState = "confirmed";
    } catch {
      requiredEvidenceState = caseItem.checklist.some(
        (item) => item.required && item.status !== "Verified",
      )
        ? "outstanding"
        : "unknown";
    }
    try {
      await inspectVerifiedPaymentForActor(actor, caseId, packageDeps);
      paymentEvidenceState = "confirmed";
    } catch {
      paymentEvidenceState =
        caseItem.payment?.status !== "Payment received" ? "outstanding" : "unknown";
    }
    if (requiredEvidenceState === "confirmed" && paymentEvidenceState === "confirmed") {
      try {
        const current =
          latest?.state === "approved"
            ? await inspectApprovedPackageForActor(actor, latest.id, packageDeps)
            : await inspectCurrentPackageSnapshotForActor(actor, caseId, packageDeps);
        manifestResult = { kind: "releasable", manifest: current.manifest };
        currentManifestHash = current.manifestHash;
      } catch {
        requiredEvidenceState = "unknown";
        paymentEvidenceState = "unknown";
        manifestResult = { kind: "blocked", blockers: [] };
      }
    }

    const [approvalRow] =
      latest?.state === "approved"
        ? await tx<{ manifest_sha256: string; approved_by: string | null }[]>`
          select manifest_sha256,approved_by from filing_packages
          where id = ${latest.id} and case_id = ${caseId} and state = 'approved'
          limit 1`
        : [];
    const [activeHandoff] = await tx<{ id: string }[]>`
      select id from package_handoffs
      where case_id = ${caseId}
        and status in ('prepared','recorded_submission','transmitted','acknowledged')
      order by created_at desc,id desc limit 1`;

    const [submissionRow] = await tx<
      {
        id: string;
        destination_reference: string | null;
        proof_version_id: string | null;
        recorded_at: Date | string | null;
      }[]
    >`
      select ph.id,ph.destination_reference,ph.proof_version_id,ph.recorded_at
      from package_handoffs ph
      join filing_packages fp on fp.id = ph.package_id and fp.case_id = ph.case_id
        and fp.manifest_sha256 = ph.manifest_sha256
      where ph.case_id = ${caseId} and fp.id = ${latest?.id ?? null}
        and fp.state = 'approved' and ph.submission_mode = 'manual'
        and ph.status = 'recorded_submission' and ph.submitted_at is not null
        and ph.recorded_at is not null
      order by ph.recorded_at desc,ph.id desc limit 1`;
    let submission: CaseReadinessSnapshot["submission"] = null;
    if (
      submissionRow?.proof_version_id &&
      submissionRow.destination_reference &&
      submissionRow.recorded_at
    ) {
      try {
        await assertProofCurrentAndSafe(
          tx,
          submissionRow.proof_version_id,
          caseId,
          caseItem.companyId,
          dependencies.storage,
        );
        submission = {
          id: submissionRow.id,
          reference: submissionRow.destination_reference,
          verifiedAt: new Date(submissionRow.recorded_at).toISOString(),
        };
      } catch {
        // A recorded submission without current proof cannot satisfy completion.
      }
    }

    let returnReconciliation: CaseReadinessSnapshot["returnReconciliation"] = null;
    if (submission) {
      const [returnRow] = await tx<
        {
          id: string;
          source_kind: "manual" | "internal" | null;
          document_version_id: string | null;
          source_object_id: string | null;
          reconciled_at: Date | string | null;
        }[]
      >`
        select hr.id,hr.source_kind,hr.document_version_id,hr.source_object_id,hr.reconciled_at
        from handoff_returns hr
        join package_handoffs ph on ph.id = hr.handoff_id
        where hr.case_id = ${caseId} and hr.company_id = ${caseItem.companyId}
          and hr.handoff_id = ${submission.id}
          and hr.external_reference = ph.destination_reference
          and hr.manifest_sha256 = ph.manifest_sha256
          and hr.match_state = 'reconciled' and hr.outcome = 'accepted'
          and hr.reconciliation_decision = 'confirm' and hr.reconciled_at is not null
          and hr.reconciled_by is not null
          and (
            (hr.source_kind = 'manual' and exists (
              select 1 from document_versions rv
              where rv.id = hr.document_version_id
                and rv.superseded_by_version_id is null
                and rv.verified_checksum_sha256 = hr.source_sha256
            ))
            or (hr.source_kind = 'internal' and exists (
              select 1 from filing_return_source_objects fso
              where fso.id::text = hr.source_object_id
                and fso.source_sha256 = hr.source_sha256
                and fso.object_version = hr.source_version
                and fso.scan_state = 'verified'
            ))
          )
          and not exists (
            select 1 from handoff_returns outstanding
            where outstanding.case_id = ${caseId} and outstanding.source_kind is not null
              and (outstanding.reconciled_at is null
                or outstanding.match_state <> 'reconciled'
                or outstanding.outcome <> 'accepted')
          )
        order by hr.reconciled_at desc,hr.id desc limit 1`;
      if (returnRow?.reconciled_at) {
        try {
          if (returnRow.source_kind === "manual" && returnRow.document_version_id) {
            await assertProofCurrentAndSafe(
              tx,
              returnRow.document_version_id,
              caseId,
              caseItem.companyId,
              dependencies.storage,
              ["receipt"],
            );
          } else if (returnRow.source_kind === "internal" && returnRow.source_object_id) {
            await verifyInternalSourceObject(tx, returnRow.source_object_id, dependencies.storage);
          } else {
            throw new Error("Return source is unavailable.");
          }
          returnReconciliation = {
            id: returnRow.id,
            status: "matched",
            outcome: "accepted",
            decision: "confirm",
            verifiedAt: new Date(returnRow.reconciled_at).toISOString(),
          };
        } catch {
          // A past decision without current source bytes remains unresolved.
        }
      }
    }

    const snapshot: CaseReadinessSnapshot = {
      caseId,
      revision: latest?.revision ?? 0,
      asOf: new Date().toISOString(),
      currentStatus: caseItem.currentStatus,
      caseLocked: Boolean(caseItem.lockedAt || caseItem.completedAt),
      requiredEvidenceState,
      paymentEvidenceState,
      manifestResult,
      currentManifestHash,
      approval: approvalRow?.approved_by
        ? { manifestHash: approvalRow.manifest_sha256, approverId: approvalRow.approved_by }
        : null,
      submission,
      activeHandoffId: activeHandoff?.id ?? null,
      returnReconciliation,
      completionBlockers: completionBlockers(caseItem).filter(
        (blocker) =>
          !latest ||
          (blocker.code !== "filing_reference_missing" &&
            blocker.code !== "confirmation_document_missing"),
      ),
    };
    return { snapshot, readiness: evaluateCaseReadiness(snapshot) };
  };
  return "begin" in db
    ? (db.begin("isolation level repeatable read read only", work) as Promise<CaseReadinessRead>)
    : work(db);
}
