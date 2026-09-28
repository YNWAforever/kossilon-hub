import type postgres from "postgres";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import { documentSafetyOf } from "@/features/documents/safety";
import type { DocumentStatus, DocumentStorage } from "@/features/documents/types";
import { entityIdSchema } from "@/features/runtime/entity-id";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import { createAnnualReturnRepository } from "./repository";
import { downloadApprovedPackageForActor, getPackageForActor } from "./package-service";
import { packageSha256 } from "./package-download";
import { refusalForHandoff, type HandoffState } from "./handoff";

type Db = SqlClient | postgres.TransactionSql;
type Tx = postgres.TransactionSql;
export type ManualSubmissionInput = {
  packageId: string;
  manifestHash: string;
  submittedAt: string;
  destinationLabel: string;
  externalReference: string;
  proofVersionId: string;
  expectedRevision: number;
};
export type SubmissionRecord = {
  id: string;
  caseId: string;
  packageId: string;
  manifestHash: string;
  destinationLabel: string;
  externalReference: string;
  proofVersionId: string;
  submittedAtUtc: string;
  recordedAtUtc: string;
  status: "recorded_submission";
};
export type SubmissionDependencies = {
  sql?: Db;
  storage: DocumentStorage;
  now?: () => Date;
};

export const manualSubmissionInputSchema = z
  .object({
    packageId: entityIdSchema,
    manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
    submittedAt: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\+08:00$/,
        "Submission time must include the Hong Kong +08:00 offset.",
      ),
    destinationLabel: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^\p{Cc}]+$/u),
    externalReference: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\p{Cc}]+$/u),
    proofVersionId: entityIdSchema,
    expectedRevision: z.number().int().min(1),
  })
  .strict();

function normalizeInput(input: ManualSubmissionInput, now: Date) {
  if (!input.proofVersionId) throw new Error("Submission proof version is required.");
  const parsed = manualSubmissionInputSchema.parse(input);
  const submittedAt = new Date(parsed.submittedAt);
  if (Number.isNaN(submittedAt.getTime())) throw new Error("Invalid HKT submission time.");
  const localInput = parsed.submittedAt.split("+")[0];
  const localRoundTrip = new Date(submittedAt.getTime() + 8 * 60 * 60_000)
    .toISOString()
    .slice(0, localInput.length);
  if (localRoundTrip !== localInput) throw new Error("Invalid HKT submission time.");
  if (submittedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new Error("Submission time is too far in the future.");
  }
  return { ...parsed, submittedAtUtc: submittedAt.toISOString() };
}

function staffId(actor: AuthenticatedActor): string {
  const staff = assertStaffAccess(actor);
  if (!staff.userId) throw new Error("Forbidden: staff database identity is required.");
  return staff.userId;
}
async function withTx<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in db ? (db.begin(work) as Promise<T>) : work(db);
}
type PackageRow = {
  id: string;
  case_id: string;
  company_id: string;
  current_status: string;
  revision: number;
  manifest_sha256: string;
  manifest_payload: string;
  state: "draft" | "approved";
  approved_by: string | null;
  approved_at: Date | string | null;
};
type ProofRow = {
  id: string;
  company_id: string;
  case_id: string | null;
  file_type: string;
  verification_status: string;
  storage_url: string;
  content_type: string | null;
  verified_checksum_sha256: string | null;
  verified_byte_size: number | string | null;
  superseded_by_version_id: string | null;
  upload_status: DocumentStatus | null;
  scan_verdict_source: "provider" | "deterministic" | null;
  checksum_sha256: string | null;
  expected_size_bytes: number | string | null;
};
type HandoffRow = {
  id: string;
  case_id: string;
  package_id: string | null;
  manifest_sha256: string;
  destination_label: string | null;
  destination_reference: string | null;
  proof_version_id: string | null;
  submitted_at: Date | string | null;
  recorded_at: Date | string | null;
  status: string;
  transmitted_at: Date | string | null;
  submission_mode: "manual" | "external-api" | null;
};
function asRecord(row: HandoffRow): SubmissionRecord {
  if (
    !row.package_id ||
    !row.destination_label ||
    !row.destination_reference ||
    !row.proof_version_id ||
    !row.submitted_at ||
    !row.recorded_at ||
    row.status !== "recorded_submission"
  ) {
    throw new Error("Manual submission record is incomplete.");
  }
  return {
    id: row.id,
    caseId: row.case_id,
    packageId: row.package_id,
    manifestHash: row.manifest_sha256,
    destinationLabel: row.destination_label,
    externalReference: row.destination_reference,
    proofVersionId: row.proof_version_id,
    submittedAtUtc: new Date(row.submitted_at).toISOString(),
    recordedAtUtc: new Date(row.recorded_at).toISOString(),
    status: "recorded_submission",
  };
}

async function assertProofCurrentAndSafe(
  tx: Db,
  proofVersionId: string,
  caseId: string,
  companyId: string,
  storage: DocumentStorage,
): Promise<void> {
  const [proof] = await tx<ProofRow[]>`
    select v.id,v.storage_url,v.content_type,
      v.verified_checksum_sha256,v.verified_byte_size,v.superseded_by_version_id,
      d.company_id,d.case_id,d.file_type,d.verification_status,
      i.status upload_status,i.scan_verdict_source,i.checksum_sha256,i.expected_size_bytes
    from document_versions v
    join documents d on d.id = v.document_id
    left join document_upload_intents i on i.id = v.intent_id
    where v.id = ${proofVersionId}`;
  if (
    !proof ||
    proof.case_id !== caseId ||
    proof.company_id !== companyId ||
    !["submission", "receipt"].includes(proof.file_type) ||
    proof.verification_status !== "verified" ||
    proof.superseded_by_version_id !== null ||
    !proof.verified_checksum_sha256 ||
    proof.verified_byte_size === null ||
    !proof.content_type
  ) {
    throw new Error(
      "Submission proof must be a current reviewed same-case submission or receipt version.",
    );
  }
  const safety = documentSafetyOf({
    uploadStatus: proof.upload_status ?? "created",
    scanVerdictSource: proof.scan_verdict_source,
    checksum: proof.checksum_sha256 ?? undefined,
    sizeBytes: proof.expected_size_bytes === null ? undefined : Number(proof.expected_size_bytes),
    verifiedChecksum: proof.verified_checksum_sha256,
    verifiedByteSize: Number(proof.verified_byte_size),
  });
  if (safety !== "verified")
    throw new Error("Submission proof needs a genuine provider scan of exact bytes.");
  const object = await storage.get(proof.storage_url);
  if (
    !object ||
    object.checksum !== proof.verified_checksum_sha256 ||
    object.sizeBytes !== Number(proof.verified_byte_size) ||
    object.contentType !== proof.content_type ||
    object.body.byteLength !== Number(proof.verified_byte_size) ||
    (await packageSha256(new Uint8Array(object.body))) !== proof.verified_checksum_sha256
  ) {
    throw new Error("Submission proof stored bytes do not match the reviewed version.");
  }
}
export async function recordManualSubmissionForActor(
  actor: AuthenticatedActor,
  input: ManualSubmissionInput,
  dependencies: SubmissionDependencies,
): Promise<SubmissionRecord> {
  const normalized = normalizeInput(input, dependencies.now?.() ?? new Date());
  const actorId = staffId(actor);
  const db = dependencies.sql ?? getSqlClient();
  return withTx(db, async (tx) => {
    const [item] = await tx<PackageRow[]>`
      select fp.id,fp.case_id,arc.company_id,arc.current_status,fp.revision,
        fp.manifest_sha256,fp.manifest_payload,fp.state,fp.approved_by,fp.approved_at
      from filing_packages fp
      join annual_return_cases arc on arc.id = fp.case_id
      where fp.id = ${normalized.packageId}
      for update of fp`;
    if (!item) throw new Error("Approved package is unavailable.");
    const repository = createAnnualReturnRepository({ sql: tx });
    try {
      await repository.assertCanMutateCase(item.case_id, actorId, "record_submission");
    } finally {
      await repository.close();
    }
    if (item.current_status === "Filed" || item.current_status === "Completed") {
      throw new Error("Filed or completed cases cannot record a new submission.");
    }
    if (
      item.state !== "approved" ||
      item.manifest_sha256 !== normalized.manifestHash ||
      item.revision !== normalized.expectedRevision ||
      !item.approved_by ||
      !item.approved_at
    ) {
      throw new Error("Manual submission requires the exact approved package revision.");
    }
    if (new Date(normalized.submittedAtUtc).getTime() < new Date(item.approved_at).getTime()) {
      throw new Error("Submission time cannot precede package approval.");
    }
    const [existing] = await tx<HandoffRow[]>`
      select * from package_handoffs where case_id = ${item.case_id}
        and status in ('prepared','recorded_submission','transmitted','acknowledged')
      order by created_at desc limit 1 for update`;
    if (
      existing?.submission_mode === "manual" &&
      existing.package_id === item.id &&
      existing.manifest_sha256 === item.manifest_sha256 &&
      existing.destination_label === normalized.destinationLabel &&
      existing.destination_reference === normalized.externalReference &&
      existing.proof_version_id === normalized.proofVersionId &&
      existing.status === "recorded_submission"
    ) {
      return asRecord(existing);
    }
    const refusal = refusalForHandoff({
      existing: existing
        ? {
            id: existing.id,
            caseId: existing.case_id,
            manifestSha256: existing.manifest_sha256,
            status: existing.status as HandoffState["status"],
            transmittedAt: existing.transmitted_at
              ? new Date(existing.transmitted_at).toISOString()
              : null,
          }
        : null,
      approvedManifestSha256: item.manifest_sha256,
      currentManifestSha256: normalized.manifestHash,
    });
    if (refusal) {
      throw new Error(
        refusal.kind === "already-out"
          ? "This case already has a live external submission or handoff."
          : "The package approval no longer covers current case evidence.",
      );
    }
    await downloadApprovedPackageForActor(actor, item.id, {
      sql: tx,
      storage: dependencies.storage,
    });
    await assertProofCurrentAndSafe(
      tx,
      normalized.proofVersionId,
      item.case_id,
      item.company_id,
      dependencies.storage,
    );
    const [saved] = await tx<HandoffRow[]>`
      insert into package_handoffs (
        case_id,manifest_sha256,manifest_payload,approved_by,released_by,
        status,transmitted_at,destination_reference,package_id,submission_mode,
        destination_label,proof_version_id,submitted_at,recorded_at
      ) values (
        ${item.case_id},${item.manifest_sha256},${item.manifest_payload},
        ${item.approved_by},${actorId},'recorded_submission',null,
        ${normalized.externalReference},${item.id},'manual',
        ${normalized.destinationLabel},${normalized.proofVersionId},
        ${normalized.submittedAtUtc},now()
      ) returning *`;
    const [staff] = await tx<{ role: string }[]>`
      select role from staff_profiles where user_id = ${actorId} and active`;
    if (!staff) throw new Error("Active staff profile required for submission audit.");
    await tx`
      insert into annual_return_audit_events (
        case_id,company_id,actor_id,actor_role,action,result,summary,metadata
      ) values (
        ${item.case_id},${item.company_id},${actorId},${staff.role},
        'record_submission','succeeded','External submission recorded',
        ${tx.json({
          packageId: item.id,
          manifestHash: item.manifest_sha256,
          destinationLabel: normalized.destinationLabel,
          externalReference: normalized.externalReference,
          proofVersionId: normalized.proofVersionId,
          submittedAtUtc: normalized.submittedAtUtc,
        })}
      )`;
    return asRecord(saved);
  });
}

export type SubmissionProofOption = {
  versionId: string;
  fileName: string;
  category: "submission" | "receipt";
  createdAt: string;
};

export async function listManualSubmissionProofsForActor(
  actor: AuthenticatedActor,
  caseId: string,
  dependencies: SubmissionDependencies,
): Promise<SubmissionProofOption[]> {
  entityIdSchema.parse(caseId);
  const db = dependencies.sql ?? getSqlClient();
  await getPackageForActor(actor, caseId, { sql: db, storage: dependencies.storage });
  const rows = await db<
    {
      id: string;
      file_name: string;
      file_type: "submission" | "receipt";
      created_at: Date | string;
    }[]
  >`
    select v.id,d.file_name,d.file_type,v.created_at
    from document_versions v
    join documents d on d.id = v.document_id
    join document_upload_intents i on i.id = v.intent_id
    where d.case_id = ${caseId}
      and d.file_type in ('submission','receipt')
      and d.verification_status = 'verified'
      and v.superseded_by_version_id is null
      and i.status = 'available' and i.scan_verdict_source = 'provider'
      and v.verified_checksum_sha256 = i.checksum_sha256
      and v.verified_byte_size = i.expected_size_bytes
    order by v.created_at desc,v.id desc`;
  return rows.map((row) => ({
    versionId: row.id,
    fileName: row.file_name,
    category: row.file_type,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function getManualSubmissionForActor(
  actor: AuthenticatedActor,
  caseId: string,
  dependencies: SubmissionDependencies,
): Promise<SubmissionRecord | null> {
  entityIdSchema.parse(caseId);
  const db = dependencies.sql ?? getSqlClient();
  await getPackageForActor(actor, caseId, { sql: db, storage: dependencies.storage });
  const [row] = await db<HandoffRow[]>`
    select * from package_handoffs
    where case_id = ${caseId}
      and submission_mode = 'manual'
      and status = 'recorded_submission'
    order by recorded_at desc,id desc limit 1`;
  return row ? asRecord(row) : null;
}
