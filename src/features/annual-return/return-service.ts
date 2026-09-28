import type postgres from "postgres";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { DocumentStorage } from "@/features/documents/types";
import { entityIdSchema } from "@/features/runtime/entity-id";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import { createAnnualReturnRepository } from "./repository";
import { assertProofCurrentAndSafe } from "./submission-service";
import { isOpenException } from "./handoff";
import { packageSha256 } from "./package-download";

type Db = SqlClient | postgres.TransactionSql;
type Tx = postgres.TransactionSql;
export type ReturnOutcome = "accepted" | "rejected" | "partial" | "unmatched";
export type ReturnIntake = {
  caseId: string;
  externalReference: string;
  manifestHash: string | null;
  outcome: "accepted" | "rejected" | "partial";
  detail?: string | null;
  source:
    | { kind: "manual"; proofVersionId: string }
    | { kind: "internal"; sourceObjectRecordId: string };
};
export type ReturnRecord = {
  id: string;
  caseId: string;
  sourceKind: "manual" | "internal";
  sourceSha256: string;
  externalReference: string;
  manifestHash: string | null;
  outcome: ReturnOutcome;
  matchState: "unmatched" | "candidate" | "reconciled";
  candidateHandoffIds: string[];
  handoffId: string | null;
  revision: number;
  receivedAt: string;
  reconciledAt: string | null;
  open: boolean;
  duplicate: boolean;
};
export type ReturnDecisionInput = {
  returnId: string;
  submissionId: string | null;
  expectedRevision: number;
  decision: "confirm" | "mark-unmatched";
  reason: string;
};
export type ReturnDependencies = { sql?: Db; storage: DocumentStorage };
export type ReturnCandidate = {
  id: string;
  externalReference: string;
  manifestHash: string;
};
export type CandidateResult =
  | { state: "candidate"; candidateIds: [string] }
  | { state: "unmatched"; candidateIds: string[] };

export const returnIntakeSchema = z
  .object({
    caseId: entityIdSchema,
    externalReference: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\p{Cc}]+$/u),
    manifestHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    outcome: z.enum(["accepted", "rejected", "partial"]),
    detail: z.string().trim().max(2000).nullable().optional(),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("manual"), proofVersionId: entityIdSchema }).strict(),
      z.object({ kind: z.literal("internal"), sourceObjectRecordId: entityIdSchema }).strict(),
    ]),
  })
  .strict();
export const returnDecisionSchema = z
  .object({
    returnId: entityIdSchema,
    submissionId: entityIdSchema.nullable(),
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["confirm", "mark-unmatched"]),
    reason: z.string().trim().max(2000),
  })
  .strict();

type CaseRow = { id: string; company_id: string; return_year: number };
type ReturnRow = {
  id: string;
  case_id: string | null;
  source_kind: "manual" | "internal" | null;
  source_sha256: string | null;
  external_reference: string | null;
  manifest_sha256: string | null;
  outcome: ReturnOutcome;
  match_state: "unmatched" | "candidate" | "reconciled";
  candidate_handoff_ids: string[];
  handoff_id: string | null;
  document_version_id: string | null;
  document_id: string | null;
  source_object_id: string | null;
  revision: number;
  received_at: Date | string;
  reconciled_at: Date | string | null;
  reconciliation_decision: string | null;
};
type SourceObjectRow = {
  id: string;
  object_version: string;
  source_sha256: string;
  byte_size: number | string;
  object_key: string;
  scan_state: string;
  content_type: string;
};

function actorIdOf(actor: AuthenticatedActor): string {
  const staff = assertStaffAccess(actor);
  if (!staff.userId) throw new Error("Active staff identity required.");
  return staff.userId;
}
async function withTx<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in db ? (db.begin(work) as Promise<T>) : work(db);
}
function asRecord(row: ReturnRow, duplicate = false): ReturnRecord {
  if (!row.case_id || !row.source_kind || !row.source_sha256 || !row.external_reference)
    throw new Error("Return intake record is incomplete.");
  return {
    id: row.id,
    caseId: row.case_id,
    sourceKind: row.source_kind,
    sourceSha256: row.source_sha256,
    externalReference: row.external_reference,
    manifestHash: row.manifest_sha256,
    outcome: row.outcome,
    matchState: row.match_state,
    candidateHandoffIds: row.candidate_handoff_ids,
    handoffId: row.handoff_id,
    revision: row.revision,
    receivedAt: new Date(row.received_at).toISOString(),
    reconciledAt: row.reconciled_at ? new Date(row.reconciled_at).toISOString() : null,
    open: isOpenException({
      outcome: row.outcome,
      reconciledAt: row.reconciled_at ? new Date(row.reconciled_at).toISOString() : null,
      matchState: row.match_state,
    }),
    duplicate,
  };
}

/** Exact reference and manifest identity only; ambiguity remains visible. */
export function candidateSubmissionIds(input: {
  externalReference: string;
  manifestHash: string | null;
  candidates: readonly ReturnCandidate[];
}): CandidateResult {
  const candidates = input.candidates
    .filter((candidate) => candidate.externalReference === input.externalReference)
    .filter(
      (candidate) => input.manifestHash === null || candidate.manifestHash === input.manifestHash,
    )
    .map((candidate) => candidate.id)
    .sort();
  return candidates.length === 1
    ? { state: "candidate", candidateIds: [candidates[0]] }
    : { state: "unmatched", candidateIds: candidates };
}

/** A matched rejection or partial return still needs a human next step. */
export const isReturnOpen = isOpenException;

async function authorizeCase(
  tx: Tx,
  actorId: string,
  caseId: string,
  action: "record_return" | "reconcile_return",
): Promise<CaseRow> {
  const [row] = await tx<CaseRow[]>`
    select id,company_id,return_year from annual_return_cases
    where id = ${caseId} for update`;
  if (!row) throw new Error("Annual return case not found.");
  const repository = createAnnualReturnRepository({ sql: tx });
  try {
    await repository.assertCanMutateCase(caseId, actorId, action);
  } finally {
    await repository.close();
  }
  return row;
}

async function writeAudit(
  tx: Tx,
  actorId: string,
  caseRow: CaseRow,
  action: "record_return_intake" | "reconcile_return",
  returnId: string,
  metadata: Record<string, unknown>,
) {
  const [staff] = await tx<{ role: string }[]>`
    select role from staff_profiles where user_id = ${actorId} and active`;
  if (!staff) throw new Error("Active staff profile required for return audit.");
  await tx`
    insert into annual_return_audit_events (
      case_id,company_id,actor_id,actor_role,action,result,summary,metadata
    ) values (
      ${caseRow.id},${caseRow.company_id},${actorId},${staff.role},
      ${action},'succeeded',
      ${action === "reconcile_return" ? "Filing return reconciled" : "Filing return intake recorded"},
      ${tx.json({ returnId, ...metadata })}
    )`;
}

export async function verifyInternalSourceObject(
  tx: Db,
  id: string,
  storage: DocumentStorage,
): Promise<{
  sourceObjectId: string;
  sourceVersion: string;
  checksum: string;
  documentId: null;
  documentVersionId: null;
}> {
  const [row] = await tx<SourceObjectRow[]>`
    select id,object_version,source_sha256,byte_size,object_key,
      scan_state,content_type
    from filing_return_source_objects where id = ${id}`;
  if (!row || row.scan_state !== "verified") {
    throw new Error("Internal return object is quarantined pending a genuine provider scan.");
  }
  const object = await storage.get(row.object_key);
  if (
    !object ||
    object.checksum !== row.source_sha256 ||
    object.sizeBytes !== Number(row.byte_size) ||
    object.contentType !== row.content_type ||
    object.body.byteLength !== Number(row.byte_size) ||
    (await packageSha256(new Uint8Array(object.body))) !== row.source_sha256
  ) {
    throw new Error("Internal return object stored bytes changed.");
  }
  return {
    sourceObjectId: row.id,
    sourceVersion: row.object_version,
    checksum: row.source_sha256,
    documentId: null,
    documentVersionId: null,
  };
}

export async function ingestReturnForActor(
  actor: AuthenticatedActor,
  input: ReturnIntake,
  dependencies: ReturnDependencies,
): Promise<ReturnRecord> {
  const parsed = returnIntakeSchema.parse(input);
  const actorId = actorIdOf(actor);
  const db = dependencies.sql ?? getSqlClient();
  return withTx(db, async (tx) => {
    const caseRow = await authorizeCase(tx, actorId, parsed.caseId, "record_return");
    const source = parsed.source;
    let evidence: {
      sourceObjectId: string;
      sourceVersion: string;
      checksum: string;
      documentId: string | null;
      documentVersionId: string | null;
    };
    if (source.kind === "manual") {
      const proof = await assertProofCurrentAndSafe(
        tx,
        source.proofVersionId,
        caseRow.id,
        caseRow.company_id,
        dependencies.storage,
        ["receipt"],
      );
      evidence = {
        sourceObjectId: proof.documentId,
        sourceVersion: source.proofVersionId,
        checksum: proof.checksum,
        documentId: proof.documentId,
        documentVersionId: source.proofVersionId,
      };
    } else {
      evidence = await verifyInternalSourceObject(
        tx,
        source.sourceObjectRecordId,
        dependencies.storage,
      );
    }
    const [existing] = await tx<ReturnRow[]>`
      select * from handoff_returns
      where source_kind = ${parsed.source.kind}
        and source_object_id = ${evidence.sourceObjectId}
        and source_sha256 = ${evidence.checksum}
      for update`;
    if (existing) {
      if (
        existing.case_id !== caseRow.id ||
        existing.external_reference !== parsed.externalReference ||
        existing.manifest_sha256 !== parsed.manifestHash ||
        existing.outcome !== parsed.outcome ||
        existing.document_version_id !== evidence.documentVersionId
      ) {
        throw new Error("Return source identity was replayed with conflicting claims.");
      }
      return asRecord(existing, true);
    }
    const candidates = await tx<
      {
        id: string;
        destination_reference: string;
        manifest_sha256: string;
      }[]
    >`
      select id,destination_reference,manifest_sha256 from package_handoffs
      where case_id = ${caseRow.id}
        and destination_reference = ${parsed.externalReference}
        and status in ('recorded_submission','transmitted','acknowledged','returned')
      order by created_at desc,id desc`;
    const selection = candidateSubmissionIds({
      externalReference: parsed.externalReference,
      manifestHash: parsed.manifestHash,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        externalReference: candidate.destination_reference,
        manifestHash: candidate.manifest_sha256,
      })),
    });
    const candidateId = selection.state === "candidate" ? selection.candidateIds[0] : null;
    const [saved] = await tx<ReturnRow[]>`
      insert into handoff_returns (
        handoff_id,document_id,outcome,detail,case_id,company_id,return_year,
        source_kind,source_object_id,source_version,source_sha256,
        document_version_id,external_reference,manifest_sha256,
        candidate_handoff_ids,match_state
      ) values (
        ${candidateId},${evidence.documentId},${parsed.outcome},
        ${parsed.detail ?? null},${caseRow.id},${caseRow.company_id},
        ${caseRow.return_year},${parsed.source.kind},
        ${evidence.sourceObjectId},${evidence.sourceVersion},
        ${evidence.checksum},${evidence.documentVersionId},
        ${parsed.externalReference},${parsed.manifestHash},
        ${selection.candidateIds},${selection.state}
      ) returning *`;
    await writeAudit(tx, actorId, caseRow, "record_return_intake", saved.id, {
      sourceKind: parsed.source.kind,
      sourceSha256: evidence.checksum,
      externalReference: parsed.externalReference,
      candidateCount: selection.candidateIds.length,
      outcome: parsed.outcome,
    });
    return asRecord(saved);
  });
}
export async function reconcileReturnForActor(
  actor: AuthenticatedActor,
  input: ReturnDecisionInput,
  dependencies: ReturnDependencies,
): Promise<ReturnRecord> {
  const parsed = returnDecisionSchema.parse(input);
  const actorId = actorIdOf(actor);
  const db = dependencies.sql ?? getSqlClient();
  return withTx(db, async (tx) => {
    const [row] = await tx<ReturnRow[]>`
      select * from handoff_returns where id = ${parsed.returnId}
      for update`;
    if (!row?.case_id) throw new Error("Return intake not found.");
    const caseRow = await authorizeCase(tx, actorId, row.case_id, "reconcile_return");
    if (row.reconciled_at) {
      if (row.reconciliation_decision === parsed.decision && row.handoff_id === parsed.submissionId)
        return asRecord(row, true);
      throw new Error("Return was already reconciled with a different decision.");
    }
    if (row.revision !== parsed.expectedRevision) {
      throw new Error("Return revision changed; reload before reconciliation.");
    }
    let submissionId: string | null = null;
    let matchState: "unmatched" | "reconciled" = "unmatched";
    if (parsed.decision === "confirm") {
      if (!parsed.submissionId) throw new Error("A submission ID is required to confirm a return.");
      const [submission] = await tx<
        {
          id: string;
          destination_reference: string | null;
          manifest_sha256: string;
        }[]
      >`
        select id,destination_reference,manifest_sha256 from package_handoffs
        where id = ${parsed.submissionId} and case_id = ${caseRow.id}`;
      if (
        !submission ||
        submission.destination_reference !== row.external_reference ||
        (row.manifest_sha256 !== null && submission.manifest_sha256 !== row.manifest_sha256)
      ) {
        throw new Error("Return reference, package manifest or case does not match submission.");
      }
      if (
        (row.manifest_sha256 === null ||
          row.candidate_handoff_ids.length !== 1 ||
          row.candidate_handoff_ids[0] !== submission.id) &&
        parsed.reason.length < 10
      ) {
        throw new Error(
          "A named reconciliation reason is required for missing hash or ambiguous identity.",
        );
      }
      if (row.source_kind === "manual" && row.document_version_id) {
        await assertProofCurrentAndSafe(
          tx,
          row.document_version_id,
          caseRow.id,
          caseRow.company_id,
          dependencies.storage,
          ["receipt"],
        );
      } else if (row.source_kind === "internal" && row.source_object_id) {
        await verifyInternalSourceObject(tx, row.source_object_id, dependencies.storage);
      } else {
        throw new Error("Return evidence is unavailable for reconciliation.");
      }
      submissionId = submission.id;
      matchState = "reconciled";
    } else if (parsed.reason.length < 10) {
      throw new Error("An unmatched return needs a named review reason.");
    }
    const [saved] = await tx<ReturnRow[]>`
      update handoff_returns
      set handoff_id = ${submissionId},
          match_state = ${matchState},
          reconciled_at = now(),reconciled_by = ${actorId},
          reconciliation_decision = ${parsed.decision},
          reconciliation_reason = ${parsed.reason},
          revision = revision + 1
      where id = ${row.id} and revision = ${parsed.expectedRevision}
      returning *`;
    if (!saved) throw new Error("Return revision changed during reconciliation.");
    await writeAudit(tx, actorId, caseRow, "reconcile_return", saved.id, {
      decision: parsed.decision,
      submissionId,
      outcome: saved.outcome,
      remainsException: isOpenException({
        outcome: saved.outcome,
        reconciledAt: new Date(saved.reconciled_at!).toISOString(),
        matchState: saved.match_state,
      }),
    });
    return asRecord(saved);
  });
}

export async function getReturnIntakesForActor(
  actor: AuthenticatedActor,
  caseId: string,
  dependencies: ReturnDependencies,
): Promise<ReturnRecord[]> {
  entityIdSchema.parse(caseId);
  const actorId = actorIdOf(actor);
  const db = dependencies.sql ?? getSqlClient();
  const repository = createAnnualReturnRepository({ sql: db });
  try {
    await repository.assertCanMutateCase(caseId, actorId, "record_return");
  } finally {
    await repository.close();
  }
  const rows = await db<ReturnRow[]>`
    select * from handoff_returns where case_id = ${caseId}
    order by received_at desc,id desc`;
  return rows.filter((row) => row.source_kind !== null).map((row) => asRecord(row));
}

/** Called only with case IDs from the server's scoped annual-return list. */
export async function listReturnExceptionsForScopedCases(
  caseIds: readonly string[],
  db: Db = getSqlClient(),
): Promise<ReturnRecord[]> {
  if (caseIds.length === 0) return [];
  for (const caseId of caseIds) entityIdSchema.parse(caseId);
  const rows = await db<ReturnRow[]>`
    select * from handoff_returns
    where case_id = any(${caseIds}::uuid[])
      and source_kind is not null
      and (reconciled_at is null or match_state <> 'reconciled'
           or outcome in ('rejected','partial','unmatched'))
    order by received_at asc,id asc`;
  return rows.map((row) => asRecord(row));
}
