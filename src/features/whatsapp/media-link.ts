import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertStaffAccess } from "@/features/auth/authorization";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import { assertStaffDocumentAccess } from "@/features/documents/authorization";
import { createDocumentRepository } from "@/features/documents/repository";
import type { DocumentStorage } from "@/features/documents/types";
import { getSqlClient, type SqlClient } from "@/server/db/client";

type QueryClient = SqlClient | postgres.TransactionSql;
function withTransaction<T>(
  client: QueryClient,
  handler: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return "begin" in client ? (client.begin(handler) as Promise<T>) : handler(client);
}
type MediaRow = {
  id: string;
  message_id: string;
  document_id: string | null;
  download_status: string;
  download_revision: number;
  download_object_key: string;
  download_checksum_sha256: string | null;
  download_content_type: string | null;
  download_byte_size: number | null;
  download_file_name: string | null;
  company_id: string | null;
  case_id: string | null;
  phone_e164: string | null;
  direction: string;
};
type CaseRow = {
  id: string;
  company_id: string;
  assigned_team_id: string | null;
  owner_id: string;
  reviewer_id: string | null;
  data_origin: string;
};
export type DocumentVersionRef = {
  documentId: string;
  versionId: string;
  revision: number;
  replayed: boolean;
};
export type LinkInboundMediaInput = {
  messageId: string;
  mediaIndex: number;
  caseId: string;
  requirementInstanceId?: string;
  expectedRevision: number;
};
export type CorrectInboundMediaInput = LinkInboundMediaInput & { reason: string };

async function loadMedia(tx: postgres.TransactionSql, messageId: string, index: number) {
  const rows = await tx<MediaRow[]>`
    select m.id,m.message_id,m.document_id,m.download_status,m.download_revision,
      m.download_object_key,m.download_checksum_sha256,m.download_content_type,
      m.download_byte_size,m.download_file_name,w.company_id,w.case_id,
      w.phone_e164,w.direction
    from whatsapp_message_media m
    join whatsapp_messages w on w.id=m.message_id
    where m.message_id=${messageId} and m.position=${index}
    for update of m
  `;
  if (rows.length !== 1) throw new Error("Inbound media position not found or ambiguous.");
  if (rows[0].direction !== "inbound") throw new Error("Only inbound media can be linked.");
  return rows[0];
}
async function authorizeTarget(
  tx: postgres.TransactionSql,
  actor: AuthenticatedActor,
  media: MediaRow,
  caseId: string,
): Promise<CaseRow> {
  const staff = assertStaffAccess(actor);
  if (!staff.userId) throw new Error("Staff database identity is required.");
  const [caseRow] = await tx<CaseRow[]>`
    select arc.id,arc.company_id,c.assigned_team_id,arc.owner_id,
      arc.reviewer_id,c.data_origin
    from annual_return_cases arc join companies c on c.id=arc.company_id
    where arc.id=${caseId} for update of arc
  `;
  if (!caseRow) throw new Error("Annual return case not found.");
  if (caseRow.data_origin === "fixture") throw new Error("Demo case is read-only.");
  assertStaffDocumentAccess(actor, {
    companyId: caseRow.company_id,
    companyTeamId: caseRow.assigned_team_id,
    caseId,
    caseOwnerId: caseRow.owner_id,
    caseReviewerId: caseRow.reviewer_id,
  });
  const annualReturns = createAnnualReturnRepository({ sql: tx });
  await annualReturns.assertCanMutateCase(caseId, staff.userId, "update_checklist");
  // The webhook's case is a heuristic (latest outbound/earliest active case).
  // The verified contact phone proves company scope; a staff member chooses the
  // target case. A phone shared across companies is deliberately unresolved.
  // WOZTELL waId may arrive as digits without '+'. Compare digits only to a
  // *verified* E.164 contact; the webhook string itself grants no authority.
  const phoneDigits = media.phone_e164?.replace(/\D/g, "") ?? "";
  if (!/^[1-9]\d{7,14}$/.test(phoneDigits)) {
    throw new Error("Inbound phone cannot prove contact scope; resolve manually.");
  }
  const companyMatches = await tx<{ company_id: string }[]>`
    select distinct company_id from company_contacts
    where regexp_replace(phone_e164, '[^0-9]', '', 'g')=${phoneDigits}
      and phone_verified_at is not null
    limit 2
  `;
  if (companyMatches.length !== 1 || companyMatches[0].company_id !== caseRow.company_id) {
    throw new Error("Inbound contact company is ambiguous or unverified.");
  }
  if (media.company_id && media.company_id !== caseRow.company_id) {
    throw new Error("Inbound conversation is assigned to another company.");
  }
  return caseRow;
}
async function checklistItemForRequirement(
  tx: postgres.TransactionSql,
  caseId: string,
  requirementInstanceId?: string,
): Promise<string | null> {
  if (!requirementInstanceId) return null;
  const [item] = await tx<{ checklist_item_id: string }[]>`
    select checklist_item_id from case_requirement_instances
    where id=${requirementInstanceId} and case_id=${caseId}
      and applicability='required'
    for share
  `;
  if (!item) throw new Error("Requirement instance does not belong to this case.");
  return item.checklist_item_id;
}
async function linkedRef(
  tx: postgres.TransactionSql,
  media: MediaRow,
  caseId: string,
  checklistItemId: string | null,
): Promise<DocumentVersionRef> {
  const [existing] = await tx<
    {
      document_id: string;
      version_id: string;
      case_id: string | null;
      checklist_item_id: string | null;
    }[]
  >`
    select d.id document_id,v.id version_id,d.case_id,i.checklist_item_id
    from documents d
    join document_upload_intents i on i.document_id=d.id
    join document_versions v on v.document_id=d.id and v.version_number=1
    where d.id=${media.document_id}
  `;
  if (!existing || existing.case_id !== caseId || existing.checklist_item_id !== checklistItemId) {
    throw new Error("Inbound media is already linked to another case or requirement.");
  }
  return {
    documentId: existing.document_id,
    versionId: existing.version_id,
    revision: media.download_revision,
    replayed: true,
  };
}

/** Human case selection turns a private download into an existing quarantined document. */
export async function linkInboundMediaForActor(
  actor: AuthenticatedActor,
  input: LinkInboundMediaInput,
  dependencies: { sql?: SqlClient | postgres.TransactionSql; storage: DocumentStorage },
): Promise<DocumentVersionRef> {
  if (
    !Number.isInteger(input.mediaIndex) ||
    input.mediaIndex < 0 ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  ) {
    throw new Error("Media position and revision must be nonnegative integers.");
  }
  const sql = dependencies.sql ?? getSqlClient();
  return withTransaction(sql, async (tx) => {
    const media = await loadMedia(tx, input.messageId, input.mediaIndex);
    const caseRow = await authorizeTarget(tx, actor, media, input.caseId);
    const checklistItemId = await checklistItemForRequirement(
      tx,
      input.caseId,
      input.requirementInstanceId,
    );
    if (media.download_status === "linked" && media.document_id) {
      return linkedRef(tx, media, input.caseId, checklistItemId);
    }
    if (media.download_revision !== input.expectedRevision)
      throw new Error("Media revision changed.");
    if (media.download_status !== "quarantined" || media.document_id) {
      throw new Error("Inbound media has not completed private quarantine download.");
    }
    if (
      !media.download_checksum_sha256 ||
      !media.download_content_type ||
      !media.download_byte_size ||
      !media.download_file_name
    ) {
      throw new Error("Quarantined media metadata is incomplete.");
    }
    const stored = await dependencies.storage.get(media.download_object_key);
    if (
      !stored ||
      stored.checksum !== media.download_checksum_sha256 ||
      stored.contentType !== media.download_content_type ||
      stored.sizeBytes !== Number(media.download_byte_size) ||
      stored.body.byteLength !== Number(media.download_byte_size)
    ) {
      throw new Error("Quarantined media readback differs from its metadata.");
    }
    const digest = await crypto.subtle.digest("SHA-256", stored.body);
    const checksum = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (checksum !== media.download_checksum_sha256)
      throw new Error("Quarantined media checksum changed.");
    const documents = createDocumentRepository({ sql: tx });
    const intent = await documents.createUploadIntent({
      companyId: caseRow.company_id,
      caseId: input.caseId,
      checklistItemId: checklistItemId ?? undefined,
      requestedByAuthUserId: actor.authUserId,
      category: "other",
      fileName: media.download_file_name,
      contentType: media.download_content_type,
      expectedSizeBytes: Number(media.download_byte_size),
      checksum,
      objectKey: media.download_object_key,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    const document = await documents.finalizeUploadIntent({
      intentId: intent.id,
      uploadedBy: null,
      source: "system",
    });
    const [version] = await tx<{ id: string }[]>`
      select id from document_versions where document_id=${document.id} and version_number=1
    `;
    if (!version) throw new Error("Quarantined document version was not created.");
    const [updated] = await tx<{ download_revision: number }[]>`
      update whatsapp_message_media set document_id=${document.id},
        download_status='linked',download_revision=download_revision+1
      where id=${media.id} and download_revision=${input.expectedRevision}
      returning download_revision
    `;
    if (!updated) throw new Error("Media revision changed during linking.");
    await tx`insert into timeline_events(company_id,case_id,event_type,actor_type,
      actor_id,description,metadata) values (${caseRow.company_id},${input.caseId},
      'whatsapp_media_linked','user',${actor.userId},
      'Inbound WhatsApp attachment linked for document review.',
      ${tx.json({
        messageId: input.messageId,
        mediaIndex: input.mediaIndex,
        documentId: document.id,
        requirementInstanceId: input.requirementInstanceId ?? null,
      })})`;
    return {
      documentId: document.id,
      versionId: version.id,
      revision: updated.download_revision,
      replayed: false,
    };
  });
}

/** Correct a human requirement assignment while evidence is still pending review. */
export async function correctInboundMediaClassificationForActor(
  actor: AuthenticatedActor,
  input: CorrectInboundMediaInput,
  dependencies: { sql?: SqlClient | postgres.TransactionSql },
): Promise<{ revision: number }> {
  if (!input.reason.trim() || input.reason.length > 500)
    throw new Error("Correction reason required.");
  const sql = dependencies.sql ?? getSqlClient();
  return withTransaction(sql, async (tx) => {
    const media = await loadMedia(tx, input.messageId, input.mediaIndex);
    const caseRow = await authorizeTarget(tx, actor, media, input.caseId);
    if (media.download_revision !== input.expectedRevision)
      throw new Error("Media revision changed.");
    if (media.download_status !== "linked" || !media.document_id) {
      throw new Error("Only linked inbound media can be corrected.");
    }
    const [old] = await tx<
      {
        intent_id: string;
        old_item_id: string | null;
        review_status: string;
        document_case_id: string | null;
      }[]
    >`
      select i.id intent_id,i.checklist_item_id old_item_id,
        d.verification_status review_status,d.case_id document_case_id
      from document_upload_intents i join documents d on d.id=i.document_id
      where d.id=${media.document_id} for update of i,d
    `;
    if (!old || old.document_case_id !== input.caseId || old.review_status !== "pending") {
      throw new Error("Reviewed or out-of-scope media cannot be reclassified.");
    }
    const newItemId = await checklistItemForRequirement(
      tx,
      input.caseId,
      input.requirementInstanceId,
    );
    if (old.old_item_id === newItemId) throw new Error("Requirement classification is unchanged.");
    if (newItemId) {
      const [newItem] = await tx<{ status: string }[]>`
        select status from annual_return_checklist_items where id=${newItemId} for update`;
      if (!newItem || !["Missing", "Rejected"].includes(newItem.status)) {
        throw new Error("Received or verified requirement is already occupied.");
      }
    }
    if (old.old_item_id)
      await tx`
      update annual_return_checklist_items set status='Missing',received_at=null,
        document_id=null,updated_at=now()
      where id=${old.old_item_id} and case_id=${input.caseId}
        and status='Received' and document_id=${media.document_id}
    `;
    await tx`update document_upload_intents set checklist_item_id=${newItemId},updated_at=now()
      where id=${old.intent_id}`;
    if (newItemId) {
      await tx`update annual_return_checklist_items set status='Received',received_at=now(),
        document_id=${media.document_id},updated_at=now()
        where id=${newItemId} and status in ('Missing','Rejected')`;
    }
    const [updated] = await tx<{ download_revision: number }[]>`
      update whatsapp_message_media set download_revision=download_revision+1
      where id=${media.id} and download_revision=${input.expectedRevision}
      returning download_revision`;
    if (!updated) throw new Error("Media revision changed during correction.");
    await tx`insert into timeline_events(company_id,case_id,event_type,actor_type,
      actor_id,description,metadata) values (${caseRow.company_id},${input.caseId},
      'whatsapp_media_classification_corrected','user',${actor.userId},
      'Inbound WhatsApp attachment requirement assignment corrected.',
      ${tx.json({
        messageId: input.messageId,
        mediaIndex: input.mediaIndex,
        documentId: media.document_id,
        fromChecklistItemId: old.old_item_id,
        toRequirementInstanceId: input.requirementInstanceId ?? null,
        reason: input.reason.trim(),
      })})`;
    return { revision: updated.download_revision };
  });
}
