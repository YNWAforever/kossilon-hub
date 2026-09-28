import type postgres from "postgres";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertAnnualReturnCaseVisible } from "./permissions";
import { createAnnualReturnRepository } from "./repository";
import {
  buildPackageManifest,
  canonicalManifestPayload,
  type ManifestCandidateEntry,
  type PackageManifest,
} from "./package-manifest";
import { documentSafetyOf } from "@/features/documents/safety";
import type { DocumentStatus, DocumentStorage } from "@/features/documents/types";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import { entityIdSchema } from "@/features/runtime/entity-id";
import {
  buildPackageArtifact,
  packageSha256,
  readVerifiedPackageArtifact,
  readVerifiedSourceBytes,
  safePackageFilename,
  type PackageSource,
} from "./package-download";

type Db = SqlClient | postgres.TransactionSql;
type Tx = postgres.TransactionSql;
type CaseRow = { id: string; company_id: string; return_year: number; current_status: string };
type RequirementRow = {
  id: string;
  checklist_item_id: string;
  party_id: string | null;
  party_name: string | null;
  requirement_key: string;
  template_version: string;
  applicability: "required" | "not_applicable" | "waived";
  applicability_reason: string | null;
  authorized_by: string | null;
  requirement_updated_at: Date | string;
  checklist_status: string | null;
  document_id: string | null;
  page_from: number | null;
  page_to: number | null;
  document_company_id: string | null;
  document_case_id: string | null;
  verification_status: "pending" | "verified" | "rejected" | null;
  verified_by: string | null;
  document_verified_at: Date | string | null;
  version_id: string | null;
  version_number: number | null;
  superseded_by_version_id: string | null;
  declared_checksum_sha256: string | null;
  verified_checksum_sha256: string | null;
  verified_byte_size: number | string | null;
  storage_url: string | null;
  file_name: string | null;
  content_type: string | null;
  upload_status: DocumentStatus | null;
  scan_verdict_source: "provider" | "deterministic" | null;
  checksum_sha256: string | null;
  expected_size_bytes: number | string | null;
};
type PaymentRow = {
  id: string;
  status: string;
  invoice_number: string;
  amount: number;
  currency: string;
  allocation_id: string | null;
  amount_minor: number | string | null;
  allocation_currency: string | null;
  allocation_invoice_ref: string | null;
  proof_version_id: string | null;
  proof_superseded_by_version_id: string | null;
  proof_verification_status: string | null;
  proof_upload_status: DocumentStatus | null;
  proof_scan_verdict_source: string | null;
  proof_checksum_sha256: string | null;
  proof_expected_size_bytes: number | string | null;
  proof_verified_checksum_sha256: string | null;
  proof_verified_byte_size: number | string | null;
  proof_storage_url: string | null;
  proof_content_type: string | null;
  observation_status: string | null;
};
type PackageRow = {
  id: string;
  case_id: string;
  revision: number;
  manifest_sha256: string;
  manifest_payload: string;
  artifact_key: string;
  artifact_sha256: string;
  artifact_size_bytes: number | string;
  state: "draft" | "approved";
  prepared_by: string;
  approved_by: string | null;
  approved_at: Date | string | null;
};
export type PackageDraft = {
  id: string;
  caseId: string;
  revision: number;
  manifestHash: string;
  artifactSha256: string;
  artifactSizeBytes: number;
  state: "draft" | "approved";
};
export type PackageApproval = PackageDraft & {
  state: "approved";
  approvedBy: string;
  approvedAt: string;
};
export type AuthorizedDownload = {
  body: ArrayBuffer;
  fileName: string;
  contentType: "application/zip";
  checksum: string;
};
export type PackageDependencies = { sql?: Db; storage: DocumentStorage };

function asDraft(row: PackageRow): PackageDraft {
  return {
    id: row.id,
    caseId: row.case_id,
    revision: row.revision,
    manifestHash: row.manifest_sha256,
    artifactSha256: row.artifact_sha256,
    artifactSizeBytes: Number(row.artifact_size_bytes),
    state: row.state,
  };
}
function userId(actor: AuthenticatedActor): string {
  const staff = assertStaffAccess(actor);
  if (!staff.userId) throw new Error("Forbidden: staff database identity is required.");
  return staff.userId;
}
async function withTx<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in db ? (db.begin(work) as Promise<T>) : work(db);
}
async function requireCaseMutation(
  tx: Db,
  actor: AuthenticatedActor,
  caseId: string,
  action: "prepare_package" | "approve_package",
): Promise<void> {
  const repository = createAnnualReturnRepository({ sql: tx });
  try {
    await repository.assertCanMutateCase(caseId, userId(actor), action);
  } finally {
    await repository.close();
  }
}

async function requireCaseRead(tx: Db, actor: AuthenticatedActor, caseId: string): Promise<void> {
  const id = userId(actor);
  const current = await tx<
    { user_id: string; role: AuthenticatedActor["role"]; team_id: string | null }[]
  >`
    select sp.user_id,sp.role,sp.team_id from staff_profiles sp
    join users u on u.id = sp.user_id and u.active
    where sp.auth_user_id = ${actor.authUserId} and sp.user_id = ${id} and sp.active`;
  if (!current[0]) throw new Error("Forbidden: staff identity is no longer active.");
  const repository = createAnnualReturnRepository({ sql: tx });
  try {
    const caseItem = await repository.getCase(caseId);
    if (!caseItem) throw new Error("Annual return case not found.");
    assertAnnualReturnCaseVisible(
      {
        id,
        role: current[0].role,
        teamId: current[0].team_id,
        active: true,
      },
      caseItem,
    );
  } finally {
    await repository.close();
  }
}

async function writePackageAudit(
  tx: Db,
  actor: AuthenticatedActor,
  caseRow: CaseRow,
  action: "prepare_package" | "approve_package",
  packageId: string,
  manifestHash: string,
): Promise<void> {
  const [staff] = await tx<
    { role: "Admin" | "Manager" | "Staff" }[]
  >`select role from staff_profiles where user_id = ${userId(actor)} and active`;
  if (!staff) throw new Error("Active staff profile required for package audit.");
  await tx`
    insert into annual_return_audit_events (
      case_id,company_id,actor_id,actor_role,action,result,summary,metadata
    ) values (
      ${caseRow.id},${caseRow.company_id},${userId(actor)},${staff.role},
      ${action},'succeeded',${action === "approve_package" ? "Filing package approved" : "Filing package prepared"},
      ${tx.json({ packageId, manifestHash })}
    )`;
}

function requireOpenCase(row: CaseRow): void {
  if (row.current_status === "Filed" || row.current_status === "Completed") {
    throw new Error("Filed or completed cases cannot prepare or approve a package.");
  }
}
type PackageSnapshot = {
  caseRow: CaseRow;
  manifest: PackageManifest;
  payload: string;
  hash: string;
  sources: PackageSource[];
};

async function loadPackageSnapshot(
  tx: Db,
  caseId: string,
  storage: DocumentStorage,
): Promise<PackageSnapshot> {
  const [caseRow] = await tx<CaseRow[]>`
    select id,company_id,return_year,current_status
    from annual_return_cases where id = ${caseId}`;
  if (!caseRow) throw new Error("Annual return case not found.");
  const [missingRequirement] = await tx<{ id: string }[]>`
    select ci.id from annual_return_checklist_items ci
    where ci.case_id = ${caseId} and ci.required
      and not exists (
        select 1 from case_requirement_instances r
        where r.case_id = ci.case_id and r.checklist_item_id = ci.id
      )
    limit 1`;
  if (missingRequirement) throw new Error("Required checklist item has no requirement instance.");
  const rows = await tx<RequirementRow[]>`
    select r.id,r.checklist_item_id,r.party_id,cp.display_name party_name,
      r.requirement_key,r.template_version,r.applicability,r.applicability_reason,r.authorized_by,
      r.updated_at requirement_updated_at,
      ci.status checklist_status,
      l.document_id,l.page_from,l.page_to,
      d.company_id document_company_id,d.case_id document_case_id,
      d.verification_status,d.verified_by,d.verified_at document_verified_at,
      v.id version_id,v.version_number,v.superseded_by_version_id,
      v.declared_checksum_sha256,v.verified_checksum_sha256,v.verified_byte_size,
      v.storage_url,v.file_name,v.content_type,
      i.status upload_status,i.scan_verdict_source,i.checksum_sha256,i.expected_size_bytes
    from case_requirement_instances r
    left join annual_return_checklist_items ci on ci.id = r.checklist_item_id
      and ci.case_id = r.case_id
    left join case_parties cp on cp.id = r.party_id and cp.case_id = r.case_id
    left join requirement_evidence_links l on l.requirement_instance_id = r.id
    left join documents d on d.id = l.document_id
    left join document_versions v on v.document_id = d.id
      and v.superseded_by_version_id is null
    left join document_upload_intents i on i.id = v.intent_id
    where r.case_id = ${caseId}
    order by r.id,l.created_at`;
  if (rows.length === 0) throw new Error("Package requires configured requirement instances.");
  const byRequirement = new Map<string, RequirementRow[]>();
  for (const row of rows) {
    const group = byRequirement.get(row.id) ?? [];
    group.push(row);
    byRequirement.set(row.id, group);
  }
  const candidates: ManifestCandidateEntry[] = [];
  const sources: PackageSource[] = [];
  for (const group of byRequirement.values()) {
    if (group.length !== 1) {
      throw new Error(
        "Package requirement has multiple evidence links; staff must select one explicitly.",
      );
    }
    const row = group[0];
    if (!row.checklist_status) {
      throw new Error("Package requirement checklist item is missing or belongs to another case.");
    }
    if (row.template_version === "legacy") {
      throw new Error("Legacy requirement needs an approved template before package preparation.");
    }
    if (row.party_id && !row.party_name) {
      throw new Error("Package requirement party is missing or belongs to another case.");
    }
    if (row.applicability === "required" && row.checklist_status !== "Verified") {
      throw new Error("Required checklist evidence has not been verified.");
    }
    if (
      row.document_id &&
      (row.document_company_id !== caseRow.company_id || row.document_case_id !== caseId)
    )
      throw new Error("Linked package evidence belongs to another company or case.");
    const version =
      row.version_id && row.document_id && row.version_number
        ? {
            id: row.version_id,
            documentId: row.document_id,
            versionNumber: row.version_number,
            declaredChecksum: row.declared_checksum_sha256,
            verifiedChecksum: row.verified_checksum_sha256,
            supersededByVersionId: row.superseded_by_version_id,
          }
        : null;
    const safety = documentSafetyOf({
      uploadStatus: row.upload_status ?? "created",
      scanVerdictSource: row.scan_verdict_source,
      checksum: row.checksum_sha256 ?? undefined,
      sizeBytes: row.expected_size_bytes === null ? undefined : Number(row.expected_size_bytes),
      verifiedChecksum: row.verified_checksum_sha256,
      verifiedByteSize: row.verified_byte_size === null ? null : Number(row.verified_byte_size),
    });
    const decision =
      row.applicability !== "required" && row.authorized_by && row.applicability_reason
        ? {
            decidedByUserId: row.authorized_by,
            decision: "authorized-not-applicable" as const,
            decidedAt: new Date(row.requirement_updated_at).toISOString(),
            reason: row.applicability_reason,
          }
        : row.verification_status === "verified" && row.verified_by && row.document_verified_at
          ? {
              decidedByUserId: row.verified_by,
              decision: "approve" as const,
              decidedAt: new Date(row.document_verified_at).toISOString(),
              reason: null,
            }
          : null;
    candidates.push({
      requirement: {
        id: row.id,
        checklistItemId: row.checklist_item_id,
        partyId: row.party_id,
        partyName: row.party_name,
        requirementKey: row.requirement_key,
        applicability: row.applicability,
        applicabilityReason: row.applicability_reason,
        evidence: [],
      },
      templateVersion: row.template_version,
      version,
      safety,
      pageFrom: row.page_from,
      pageTo: row.page_to,
      decision,
      findings: [],
    });
    if (
      version &&
      row.storage_url &&
      row.file_name &&
      row.content_type &&
      row.verified_checksum_sha256 &&
      row.verified_byte_size !== null
    ) {
      sources.push({
        versionId: version.id,
        objectKey: row.storage_url,
        fileName: row.file_name,
        contentType: row.content_type,
        checksum: row.verified_checksum_sha256,
        sizeBytes: Number(row.verified_byte_size),
      });
    }
  }
  if (sources.length === 0)
    throw new Error("Package requires at least one verified filing document.");
  const requirementIds = [...byRequirement.keys()];
  const versionIds = candidates
    .map((item) => item.version?.id)
    .filter((id): id is string => Boolean(id));
  const [finding] = await tx<{ id: string }[]>`
    select id from document_findings
    where outcome = 'issue' and severity = 'critical' and tier <> 'provider'
      and resolved_by is null
      and (requirement_instance_id = any(${requirementIds}::uuid[])
        or document_version_id = any(${versionIds}::uuid[]))
    limit 1`;
  if (finding) throw new Error("Unresolved critical finding blocks package preparation.");

  const [payment] = await tx<PaymentRow[]>`
    select p.id,p.status,p.invoice_number,p.amount,p.currency,
      a.id allocation_id,a.amount_minor,a.currency allocation_currency,
      a.invoice_ref allocation_invoice_ref,a.proof_version_id,
      v.superseded_by_version_id proof_superseded_by_version_id,
      d.verification_status proof_verification_status,
      i.status proof_upload_status,i.scan_verdict_source proof_scan_verdict_source,
      i.checksum_sha256 proof_checksum_sha256,
      i.expected_size_bytes proof_expected_size_bytes,
      v.verified_checksum_sha256 proof_verified_checksum_sha256,
      v.verified_byte_size proof_verified_byte_size,
      v.storage_url proof_storage_url,v.content_type proof_content_type,
      o.status observation_status
    from payments p
    left join payment_proof_allocations a on a.payment_id = p.id
    left join nar_import_payment_observations o on o.id = a.observation_id
    left join document_versions v on v.id = a.proof_version_id
    left join documents d on d.id = v.document_id
      and d.case_id = p.case_id and d.company_id = p.company_id
    left join document_upload_intents i on i.id = v.intent_id
    where p.case_id = ${caseId}`;
  if (
    !payment ||
    !payment.allocation_id ||
    payment.status !== "Payment received" ||
    payment.observation_status !== "matched" ||
    payment.proof_superseded_by_version_id !== null ||
    payment.proof_verification_status !== "verified" ||
    payment.proof_upload_status !== "available" ||
    payment.proof_scan_verdict_source !== "provider" ||
    !payment.proof_storage_url ||
    !payment.proof_content_type ||
    !payment.proof_verified_checksum_sha256 ||
    payment.proof_verified_byte_size === null ||
    payment.proof_checksum_sha256 !== payment.proof_verified_checksum_sha256 ||
    Number(payment.proof_expected_size_bytes) !== Number(payment.proof_verified_byte_size) ||
    Number(payment.amount) * 100 !== Number(payment.amount_minor) ||
    payment.currency !== payment.allocation_currency ||
    payment.invoice_number !== payment.allocation_invoice_ref
  ) {
    throw new Error("Package requires a current reconciled payment and verified proof.");
  }
  await readVerifiedSourceBytes(
    storage,
    {
      objectKey: payment.proof_storage_url,
      checksum: payment.proof_verified_checksum_sha256,
      sizeBytes: Number(payment.proof_verified_byte_size),
      contentType: payment.proof_content_type,
    },
    "Payment proof",
  );
  const templateVersions = [...new Set(rows.map((row) => row.template_version))].sort();
  const result = buildPackageManifest({
    caseId,
    returnYear: caseRow.return_year,
    requirementTemplateVersion: templateVersions.join("+"),
    entries: candidates,
  });
  if (result.kind === "blocked") {
    throw new Error(
      "Package manifest blocked: " + result.blockers.map((blocker) => blocker.kind).join(", "),
    );
  }
  const manifest: PackageManifest = {
    ...result.manifest,
    payment: {
      status: payment.status,
      allocationId: payment.allocation_id,
      proofVersionId: payment.proof_version_id,
      amountMinor: Number(payment.amount_minor),
      currency: payment.currency,
      invoiceRef: payment.invoice_number,
    },
  };
  const payload = canonicalManifestPayload(manifest);
  const hash = await packageSha256(new TextEncoder().encode(payload));
  return { caseRow, manifest, payload, hash, sources };
}
async function latestPackage(
  tx: Db,
  caseId: string,
  forUpdate = false,
): Promise<PackageRow | null> {
  const rows = forUpdate
    ? await tx<PackageRow[]>`
        select * from filing_packages where case_id = ${caseId}
        order by revision desc limit 1 for update`
    : await tx<PackageRow[]>`
        select * from filing_packages where case_id = ${caseId}
        order by revision desc limit 1`;
  return rows[0] ?? null;
}

export async function getPackageForActor(
  actor: AuthenticatedActor,
  caseId: string,
  dependencies: PackageDependencies,
): Promise<PackageDraft | null> {
  entityIdSchema.parse(caseId);
  const db = dependencies.sql ?? getSqlClient();
  await requireCaseRead(db, actor, caseId);
  const row = await latestPackage(db, caseId);
  return row ? asDraft(row) : null;
}
export async function preparePackageForActor(
  actor: AuthenticatedActor,
  input: { caseId: string; expectedRevision: number },
  dependencies: PackageDependencies,
): Promise<PackageDraft> {
  entityIdSchema.parse(input.caseId);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("Invalid expected package revision.");
  }
  const db = dependencies.sql ?? getSqlClient();
  await requireCaseMutation(db, actor, input.caseId, "prepare_package");
  const initial = await loadPackageSnapshot(db, input.caseId, dependencies.storage);
  requireOpenCase(initial.caseRow);
  const latest = await latestPackage(db, input.caseId);
  if ((latest?.revision ?? 0) !== input.expectedRevision) {
    throw new Error("Package revision changed; reload before preparation.");
  }
  if (latest && latest.state === "draft" && latest.manifest_sha256 === initial.hash) {
    try {
      await readVerifiedPackageArtifact(dependencies.storage, {
        objectKey: latest.artifact_key,
        checksum: latest.artifact_sha256,
        sizeBytes: Number(latest.artifact_size_bytes),
      });
      return asDraft(latest);
    } catch {
      // A missing or corrupt draft object is rebuilt from verified source bytes.
    }
  }
  if (latest && latest.state === "approved" && latest.manifest_sha256 === initial.hash) {
    throw new Error("The current package is already approved.");
  }
  const artifact = await buildPackageArtifact(
    initial.manifest,
    initial.sources,
    dependencies.storage,
  );
  const artifactKey =
    "packages/" + input.caseId + "/" + initial.hash + "/" + artifact.checksum + ".zip";
  await dependencies.storage.put({
    objectKey: artifactKey,
    body: artifact.body,
    checksum: artifact.checksum,
    contentType: "application/zip",
    sizeBytes: artifact.sizeBytes,
  });
  await readVerifiedPackageArtifact(dependencies.storage, {
    objectKey: artifactKey,
    checksum: artifact.checksum,
    sizeBytes: artifact.sizeBytes,
  });
  return withTx(db, async (tx) => {
    await requireCaseMutation(tx, actor, input.caseId, "prepare_package");
    const current = await loadPackageSnapshot(tx, input.caseId, dependencies.storage);
    requireOpenCase(current.caseRow);
    if (current.hash !== initial.hash || current.payload !== initial.payload) {
      throw new Error("Package evidence changed during preparation; retry from current case.");
    }
    const previous = await latestPackage(tx, input.caseId, true);
    if ((previous?.revision ?? 0) !== input.expectedRevision) {
      throw new Error("Package revision changed; reload before preparation.");
    }
    if (
      previous?.state === "draft" &&
      previous.manifest_sha256 === current.hash &&
      previous.artifact_sha256 === artifact.checksum
    ) {
      return asDraft(previous);
    }
    const [saved] = await tx<PackageRow[]>`
      insert into filing_packages (
        case_id,revision,manifest_sha256,manifest_payload,artifact_key,
        artifact_sha256,artifact_size_bytes,prepared_by
      ) values (
        ${input.caseId},${input.expectedRevision + 1},${current.hash},
        ${current.payload},${artifactKey},${artifact.checksum},
        ${artifact.sizeBytes},${userId(actor)}
      ) returning *`;
    await writePackageAudit(
      tx,
      actor,
      current.caseRow,
      "prepare_package",
      saved.id,
      saved.manifest_sha256,
    );
    return asDraft(saved);
  });
}

export async function approvePackageForActor(
  actor: AuthenticatedActor,
  input: { packageId: string; manifestHash: string; expectedRevision: number },
  dependencies: PackageDependencies,
): Promise<PackageApproval> {
  entityIdSchema.parse(input.packageId);
  if (
    !/^[0-9a-f]{64}$/.test(input.manifestHash) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    throw new Error("Invalid package approval identity.");
  }
  userId(actor);
  const db = dependencies.sql ?? getSqlClient();
  const [packageRow] = await db<PackageRow[]>`
    select * from filing_packages where id = ${input.packageId}`;
  if (!packageRow) throw new Error("Filing package not found.");
  await requireCaseMutation(db, actor, packageRow.case_id, "approve_package");
  if (
    packageRow.state !== "draft" ||
    packageRow.revision !== input.expectedRevision ||
    packageRow.manifest_sha256 !== input.manifestHash
  ) {
    throw new Error("Package approval identity is stale or already decided.");
  }
  await readVerifiedPackageArtifact(dependencies.storage, {
    objectKey: packageRow.artifact_key,
    checksum: packageRow.artifact_sha256,
    sizeBytes: Number(packageRow.artifact_size_bytes),
  });
  return withTx(db, async (tx) => {
    await requireCaseMutation(tx, actor, packageRow.case_id, "approve_package");
    const latest = await latestPackage(tx, packageRow.case_id, true);
    if (
      !latest ||
      latest.id !== input.packageId ||
      latest.state !== "draft" ||
      latest.revision !== input.expectedRevision ||
      latest.manifest_sha256 !== input.manifestHash
    ) {
      throw new Error("Package approval identity is stale or already decided.");
    }
    const snapshot = await loadPackageSnapshot(tx, packageRow.case_id, dependencies.storage);
    requireOpenCase(snapshot.caseRow);
    if (snapshot.hash !== latest.manifest_sha256 || snapshot.payload !== latest.manifest_payload) {
      throw new Error("Case evidence or payment changed; prepare a new package revision.");
    }
    const [approved] = await tx<PackageRow[]>`
      update filing_packages
      set state = 'approved',approved_by = ${userId(actor)},approved_at = now()
      where id = ${latest.id} and state = 'draft'
      returning *`;
    if (!approved?.approved_by || !approved.approved_at) {
      throw new Error("Package approval was not recorded.");
    }
    await writePackageAudit(
      tx,
      actor,
      snapshot.caseRow,
      "approve_package",
      approved.id,
      approved.manifest_sha256,
    );
    return {
      ...asDraft(approved),
      state: "approved",
      approvedBy: approved.approved_by,
      approvedAt: new Date(approved.approved_at).toISOString(),
    };
  });
}

export type VerifiedPackageSnapshot = {
  packageId: string;
  caseId: string;
  revision: number;
  manifestHash: string;
  manifest: PackageManifest;
  approvedBy: string;
  body: ArrayBuffer;
  checksum: string;
};

/** The same current manifest and stored-byte gate used by approved downloads. */
export async function inspectApprovedPackageForActor(
  actor: AuthenticatedActor,
  packageId: string,
  dependencies: PackageDependencies,
): Promise<VerifiedPackageSnapshot> {
  entityIdSchema.parse(packageId);
  userId(actor);
  const db = dependencies.sql ?? getSqlClient();
  const [packageRow] = await db<PackageRow[]>`
    select * from filing_packages where id = ${packageId}`;
  if (!packageRow) throw new Error("Filing package not found.");
  await requireCaseRead(db, actor, packageRow.case_id);
  if (packageRow.state !== "approved" || !packageRow.approved_by) {
    throw new Error("Only an approved package can be downloaded.");
  }
  const latest = await latestPackage(db, packageRow.case_id);
  if (latest?.id !== packageId) throw new Error("A newer package revision exists.");
  const snapshot = await loadPackageSnapshot(db, packageRow.case_id, dependencies.storage);
  if (
    snapshot.hash !== packageRow.manifest_sha256 ||
    snapshot.payload !== packageRow.manifest_payload
  ) {
    throw new Error("Approved package is stale; prepare and approve a new revision.");
  }
  const body = await readVerifiedPackageArtifact(dependencies.storage, {
    objectKey: packageRow.artifact_key,
    checksum: packageRow.artifact_sha256,
    sizeBytes: Number(packageRow.artifact_size_bytes),
  });
  return {
    packageId: packageRow.id,
    caseId: packageRow.case_id,
    revision: packageRow.revision,
    manifestHash: snapshot.hash,
    manifest: snapshot.manifest,
    approvedBy: packageRow.approved_by,
    body,
    checksum: packageRow.artifact_sha256,
  };
}

export async function downloadApprovedPackageForActor(
  actor: AuthenticatedActor,
  packageId: string,
  dependencies: PackageDependencies,
): Promise<AuthorizedDownload> {
  const verified = await inspectApprovedPackageForActor(actor, packageId, dependencies);
  return {
    body: verified.body,
    fileName: safePackageFilename("NAR1-" + verified.caseId + "-v" + verified.revision) + ".zip",
    contentType: "application/zip",
    checksum: verified.checksum,
  };
}
