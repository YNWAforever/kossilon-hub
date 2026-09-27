import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import type { AnnualReturnAction } from "@/features/annual-return/permissions";
import type { SqlClient } from "@/server/db/client";
import type { ActiveDomainAction, BulkPreviewInput } from "./types";

type Db = SqlClient | postgres.TransactionSql;
export type DomainBatchInput = Extract<BulkPreviewInput, { action: ActiveDomainAction }>;
type DomainItem = DomainBatchInput["parameters"]["items"][number];
export type DomainPreviewDecision = {
  resourceId: string;
  revision: number;
  state: "eligible" | "conflict" | "forbidden";
  reasonCode: string | null;
};

export function isDomainAction(action: string): action is ActiveDomainAction {
  return ["reconcilePayments", "preparePackages", "recordSubmissions", "matchReturns"].includes(
    action,
  );
}

export function domainResourceId(action: ActiveDomainAction, item: DomainItem): string {
  switch (action) {
    case "reconcilePayments":
      return (
        item as Extract<
          DomainBatchInput,
          { action: "reconcilePayments" }
        >["parameters"]["items"][number]
      ).observationId;
    case "preparePackages":
      return (
        item as Extract<
          DomainBatchInput,
          { action: "preparePackages" }
        >["parameters"]["items"][number]
      ).caseId;
    case "recordSubmissions":
      return (
        item as Extract<
          DomainBatchInput,
          { action: "recordSubmissions" }
        >["parameters"]["items"][number]
      ).packageId;
    case "matchReturns": {
      const source = (
        item as Extract<DomainBatchInput, { action: "matchReturns" }>["parameters"]["items"][number]
      ).source;
      return source.kind === "manual" ? source.proofVersionId : source.sourceObjectRecordId;
    }
  }
}

function actionPermission(action: ActiveDomainAction): AnnualReturnAction {
  switch (action) {
    case "reconcilePayments":
      return "update_payment";
    case "preparePackages":
      return "prepare_package";
    case "recordSubmissions":
      return "record_submission";
    case "matchReturns":
      return "record_return";
  }
}

export async function previewDomainItemsForActor(
  actor: AuthenticatedActor,
  input: DomainBatchInput,
  sql: Db,
): Promise<DomainPreviewDecision[]> {
  const items = input.parameters.items as DomainItem[];
  const resourceIds = items.map((item) => domainResourceId(input.action, item));
  if (
    new Set(resourceIds).size !== resourceIds.length ||
    new Set(input.selection.ids).size !== input.selection.ids.length ||
    resourceIds.length !== input.selection.ids.length ||
    resourceIds.some((id) => !input.selection.ids.includes(id))
  )
    throw new Error("Domain batch IDs must exactly match unique item inputs.");

  if (!actor.userId) throw new Error("Forbidden: staff database identity is required.");
  const actorId = actor.userId;
  const repository = createAnnualReturnRepository({ sql });
  const decisions: DomainPreviewDecision[] = [];
  try {
    for (const item of items) {
      const resourceId = domainResourceId(input.action, item);
      const caseId = item.caseId;
      try {
        await repository.assertCanMutateCase(caseId, actorId, actionPermission(input.action));
      } catch {
        decisions.push({
          resourceId,
          revision: 1,
          state: "forbidden",
          reasonCode: "CASE_OUT_OF_SCOPE",
        });
        continue;
      }
      if (input.action === "reconcilePayments") {
        const current = item as Extract<
          DomainBatchInput,
          { action: "reconcilePayments" }
        >["parameters"]["items"][number];
        const [row] = await sql<{ revision: number; status: string }[]>`
          select revision,status from nar_import_payment_observations
          where id=${current.observationId} and case_id=${caseId}`;
        let proofReady = current.decision === "reject";
        if (current.decision === "match" && current.proofVersionId && current.confirmation) {
          const [proof] = await sql<{ id: string }[]>`
            select v.id from document_versions v
            join documents d on d.id=v.document_id
            join document_upload_intents i on i.id=v.intent_id
            where v.id=${current.proofVersionId} and d.case_id=${caseId}
              and d.file_type='payment' and d.verification_status='verified'
              and v.superseded_by_version_id is null
              and i.status='available' and i.scan_verdict_source='provider'
              and v.verified_checksum_sha256=i.checksum_sha256
              and v.verified_byte_size=i.expected_size_bytes`;
          proofReady = Boolean(proof);
        }
        decisions.push({
          resourceId,
          revision: row?.revision ?? current.expectedRevision,
          state:
            row?.revision === current.expectedRevision &&
            !["matched", "rejected"].includes(row.status) &&
            proofReady
              ? "eligible"
              : "conflict",
          reasonCode: !row
            ? "OBSERVATION_UNAVAILABLE"
            : row.revision !== current.expectedRevision
              ? "REVISION_CHANGED"
              : ["matched", "rejected"].includes(row.status)
                ? "ALREADY_DECIDED"
                : !proofReady
                  ? "PAYMENT_PROOF_NOT_READY"
                  : null,
        });
      } else if (input.action === "preparePackages") {
        const current = item as Extract<
          DomainBatchInput,
          { action: "preparePackages" }
        >["parameters"]["items"][number];
        const [row] = await sql<{ revision: number; state: string }[]>`
          select revision,state from filing_packages where case_id=${caseId}
          order by revision desc limit 1`;
        const revision = row?.revision ?? 0;
        decisions.push({
          resourceId,
          revision: revision + 1,
          state:
            revision === current.expectedRevision && row?.state !== "approved"
              ? "eligible"
              : "conflict",
          reasonCode:
            revision !== current.expectedRevision
              ? "REVISION_CHANGED"
              : row?.state === "approved"
                ? "PACKAGE_APPROVED"
                : null,
        });
      } else if (input.action === "recordSubmissions") {
        const current = item as Extract<
          DomainBatchInput,
          { action: "recordSubmissions" }
        >["parameters"]["items"][number];
        const [row] = await sql<{ revision: number; state: string; manifest_sha256: string }[]>`
          select revision,state,manifest_sha256 from filing_packages
          where id=${current.packageId} and case_id=${caseId}`;
        const [proof] = await sql<{ id: string }[]>`
          select v.id from document_versions v
          join documents d on d.id=v.document_id
          join document_upload_intents i on i.id=v.intent_id
          where v.id=${current.proofVersionId} and d.case_id=${caseId}
            and d.file_type in ('submission','receipt')
            and d.verification_status='verified'
            and v.superseded_by_version_id is null
            and i.status='available' and i.scan_verdict_source='provider'
            and v.verified_checksum_sha256=i.checksum_sha256
            and v.verified_byte_size=i.expected_size_bytes`;
        decisions.push({
          resourceId,
          revision: row?.revision ?? current.expectedRevision,
          state:
            row?.revision === current.expectedRevision &&
            row.state === "approved" &&
            row.manifest_sha256 === current.manifestHash &&
            Boolean(proof)
              ? "eligible"
              : "conflict",
          reasonCode: !row
            ? "PACKAGE_UNAVAILABLE"
            : row.revision !== current.expectedRevision ||
                row.manifest_sha256 !== current.manifestHash
              ? "REVISION_CHANGED"
              : row.state !== "approved"
                ? "PACKAGE_NOT_APPROVED"
                : !proof
                  ? "SUBMISSION_PROOF_NOT_READY"
                  : null,
        });
      } else {
        const current = item as Extract<
          DomainBatchInput,
          { action: "matchReturns" }
        >["parameters"]["items"][number];
        if (current.source.kind === "manual") {
          const [row] = await sql<
            {
              version_number: number;
              scan_verdict_source: string | null;
              upload_status: string;
              verification_status: string;
            }[]
          >`
            select v.version_number,i.scan_verdict_source,i.status upload_status,d.verification_status
            from document_versions v join documents d on d.id=v.document_id
            join document_upload_intents i on i.id=v.intent_id
            where v.id=${current.source.proofVersionId} and d.case_id=${caseId}
              and v.superseded_by_version_id is null and d.file_type='receipt'
              and v.verified_checksum_sha256=i.checksum_sha256
              and v.verified_byte_size=i.expected_size_bytes`;
          const safe =
            row?.scan_verdict_source === "provider" &&
            row.upload_status === "available" &&
            row.verification_status === "verified";
          decisions.push({
            resourceId,
            revision: row?.version_number ?? 1,
            state: safe ? "eligible" : "conflict",
            reasonCode: safe ? null : "RETURN_PROOF_NOT_READY",
          });
        } else {
          const [row] = await sql<{ scan_state: string }[]>`
            select scan_state from filing_return_source_objects where id=${current.source.sourceObjectRecordId}`;
          decisions.push({
            resourceId,
            revision: 1,
            state: row?.scan_state === "verified" ? "eligible" : "conflict",
            reasonCode: row?.scan_state === "verified" ? null : "RETURN_SOURCE_NOT_READY",
          });
        }
      }
    }
  } finally {
    await repository.close();
  }
  return decisions;
}
