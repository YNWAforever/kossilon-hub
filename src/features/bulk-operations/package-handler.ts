import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  preparePackageForActor,
  type PackageDraft,
} from "@/features/annual-return/package-service";
import {
  recordManualSubmissionForActor,
  type ManualSubmissionInput,
  type SubmissionRecord,
} from "@/features/annual-return/submission-service";
import {
  ingestReturnForActor,
  type ReturnIntake,
  type ReturnRecord,
} from "@/features/annual-return/return-service";
import type { DocumentStorage } from "@/features/documents/types";
import type { SqlClient } from "@/server/db/client";
import type { DomainItemResult } from "./domain-types";

type Db = SqlClient | postgres.TransactionSql;
type PreparePackage = (
  actor: AuthenticatedActor,
  input: { caseId: string; expectedRevision: number },
) => Promise<PackageDraft>;
type RecordSubmission = (
  actor: AuthenticatedActor,
  input: ManualSubmissionInput,
) => Promise<SubmissionRecord>;
type IngestReturn = (actor: AuthenticatedActor, input: ReturnIntake) => Promise<ReturnRecord>;
type RuntimeDependencies = { sql?: Db; storage?: DocumentStorage };

function requireStorage(storage: DocumentStorage | undefined): DocumentStorage {
  if (!storage) throw new Error("Document storage is unavailable for this batch action.");
  return storage;
}

/** Package preparation creates a draft only. Human approval remains a separate action. */
export async function applyPackageItem(
  actor: AuthenticatedActor,
  item: { caseId: string; expectedRevision: number },
  dependencies: RuntimeDependencies & { preparePackage?: PreparePackage } = {},
): Promise<DomainItemResult> {
  const service =
    dependencies.preparePackage ??
    ((currentActor, currentItem) =>
      preparePackageForActor(currentActor, currentItem, {
        sql: dependencies.sql,
        storage: requireStorage(dependencies.storage),
      }));
  const result = await service(actor, item);
  if (result.state !== "draft") throw new Error("Bulk package preparation must not approve.");
  return {
    state: result.revision === item.expectedRevision ? "skipped" : "succeeded",
    reasonCode: result.revision === item.expectedRevision ? "PACKAGE_DRAFT_EXISTS" : null,
    revision: result.revision,
    auditRef: result.id,
  };
}

/** Recording requires the exact external reference and verified proof per item. */
export async function applySubmissionItem(
  actor: AuthenticatedActor,
  item: ManualSubmissionInput,
  dependencies: RuntimeDependencies & { recordSubmission?: RecordSubmission } = {},
): Promise<DomainItemResult> {
  const service =
    dependencies.recordSubmission ??
    ((currentActor, currentItem) =>
      recordManualSubmissionForActor(currentActor, currentItem, {
        sql: dependencies.sql,
        storage: requireStorage(dependencies.storage),
      }));
  const result = await service(actor, item);
  return {
    state: "succeeded",
    reasonCode: null,
    revision: item.expectedRevision,
    auditRef: result.id,
  };
}

/** Intake finds candidates only; confirming a return stays a human single-item action. */
export async function applyReturnItem(
  actor: AuthenticatedActor,
  item: ReturnIntake,
  dependencies: RuntimeDependencies & { ingestReturn?: IngestReturn } = {},
): Promise<DomainItemResult> {
  const service =
    dependencies.ingestReturn ??
    ((currentActor, currentItem) =>
      ingestReturnForActor(currentActor, currentItem, {
        sql: dependencies.sql,
        storage: requireStorage(dependencies.storage),
      }));
  const result = await service(actor, item);
  return {
    state: result.duplicate
      ? "skipped"
      : result.matchState === "candidate"
        ? "succeeded"
        : "conflict",
    reasonCode: result.duplicate
      ? "RETURN_ALREADY_INGESTED"
      : result.matchState === "candidate"
        ? "RETURN_CANDIDATE_ONLY"
        : "RETURN_AMBIGUOUS_OR_UNMATCHED",
    revision: result.revision,
    auditRef: result.id,
  };
}
