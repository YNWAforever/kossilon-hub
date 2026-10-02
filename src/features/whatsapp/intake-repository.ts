import type postgres from "postgres";
import { sql as defaultSql } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertStaffAccess } from "@/features/auth/authorization";
import {
  assertStaffDocumentAccess,
  type DocumentAccessSubject,
} from "@/features/documents/authorization";
import { createDocumentRepository } from "@/features/documents/repository";
import {
  createDocumentUploadIntentForActor,
  finalizeDocumentUploadForActor,
  type DocumentOperationDependencies,
} from "@/features/documents/server-fns";
import type { DocumentCategory, DocumentStorage } from "@/features/documents/types";
import type { MediaDownloadResult } from "./media-download";

type Query = postgres.Sql | postgres.TransactionSql;
type Tx = postgres.TransactionSql;
type Message = {
  id: string;
  company_id: string | null;
  case_id: string | null;
  mapping_revision: number;
  direction: string;
};
type Media = {
  id: string;
  message_id: string;
  provider_media_id: string;
  provider_media_kind: "file" | "legacy-wa-media";
  media_type: string;
  intake_intent_id: string | null;
  document_id: string | null;
};
export type IntakeInput = {
  mediaId: string;
  expectedMappingVersion: number;
  category: DocumentCategory;
  checklistItemId?: string;
};
type Downloaded = Extract<MediaDownloadResult, { status: "downloaded" }>;
const conflict = () =>
  Object.assign(new Error("WhatsApp mapping or intake changed; refresh its preview."), {
    statusCode: 409,
  });
function transaction<T>(sql: Query, action: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in sql ? (sql.begin(action) as Promise<T>) : action(sql);
}

/** Current request identity must still agree with the authoritative profile. */
async function staff(sql: Query, actor: AuthenticatedActor, lock = false) {
  assertStaffAccess(actor);
  const [current] = await sql<{ role: string; team_id: string | null }[]>`
    select u.role,u.team_id from users u join staff_profiles sp on sp.user_id=u.id
    where u.id=${actor.userId!} and u.active and sp.active and sp.auth_user_id=${actor.authUserId}
      and sp.role=u.role and sp.team_id is not distinct from u.team_id
      and u.role=${actor.role} and u.team_id is not distinct from ${actor.teamId}
    ${lock ? sql`for share of u,sp` : sql``}`;
  if (!current) throw new Error("Forbidden: current verified staff identity is required.");
}

async function subject(sql: Query, message: Message, lock = false): Promise<DocumentAccessSubject> {
  if (!message.company_id || !message.case_id)
    throw new Error("Choose and approve the message's case mapping before intake.");
  if (lock) {
    await sql`select id from companies where id=${message.company_id} for update`;
    await sql`select id from annual_return_cases where id=${message.case_id} for update`;
  }
  const [scope] = await sql<
    {
      assigned_team_id: string | null;
      owner_id: string | null;
      reviewer_id: string | null;
      current_status: string;
      locked_at: string | null;
      data_origin: string;
    }[]
  >`
    select c.assigned_team_id,c.data_origin,a.owner_id,a.reviewer_id,a.current_status,a.locked_at
    from companies c join annual_return_cases a on a.company_id=c.id
    where c.id=${message.company_id} and a.id=${message.case_id}`;
  if (!scope || scope.data_origin !== "client")
    throw new Error("WhatsApp intake requires an actual client case.");
  if (scope.locked_at || ["Filed", "Completed"].includes(scope.current_status))
    throw new Error("Case is locked or closed; intake is unavailable.");
  return {
    companyId: message.company_id,
    companyTeamId: scope.assigned_team_id,
    caseId: message.case_id,
    caseOwnerId: scope.owner_id,
    caseReviewerId: scope.reviewer_id,
  };
}

export function createWhatsAppIntakeRepository(options: {
  sql?: Query;
  storage?: DocumentStorage;
}) {
  const sql = options.sql ?? defaultSql;
  const dependencies = (tx: Tx): DocumentOperationDependencies => {
    if (!options.storage) throw new Error("Document storage binding is required for media intake.");
    return {
      repository: createDocumentRepository({ sql: tx }),
      storage: options.storage,
      createScanner: () => {
        throw new Error("Intake quarantines bytes; scanning belongs to the existing scan worker.");
      },
      authorizeDocument: async (actor, scope) => {
        await staff(tx, actor, true);
        assertStaffDocumentAccess(actor, scope);
      },
    };
  };
  async function getMessagePreview(actor: AuthenticatedActor, messageId: string) {
    await staff(sql, actor);
    const [message] = await sql<
      Message[]
    >`select id,company_id,case_id,mapping_revision,direction from whatsapp_messages where id=${messageId}`;
    if (!message || message.direction !== "inbound") throw new Error("Inbound message not found.");
    if (message.company_id) {
      const scope = await createDocumentRepository({ sql }).getCompanyAccessSubject(
        message.company_id,
        message.case_id ?? undefined,
      );
      if (!scope) throw new Error("Message scope not found.");
      assertStaffDocumentAccess(actor, scope);
    } else if (actor.role !== "Admin")
      throw new Error("Forbidden: unmapped messages require Admin review.");
    const media = await sql<
      Media[]
    >`select id,message_id,provider_media_id,provider_media_kind,media_type,intake_intent_id,document_id from whatsapp_message_media where message_id=${messageId} order by position,id`;
    return {
      messageId,
      companyId: message.company_id,
      caseId: message.case_id,
      version: message.mapping_revision,
      media: media.map((m) => ({
        id: m.id,
        providerMediaId: m.provider_media_id,
        kind: m.provider_media_kind,
        mediaType: m.media_type,
        intentId: m.intake_intent_id,
        documentId: m.document_id,
      })),
    };
  }
  async function mapMessage(
    actor: AuthenticatedActor,
    input: { messageId: string; caseId: string; expectedVersion: number; reason: string },
  ) {
    assertStaffAccess(actor);
    if (actor.role !== "Admin")
      throw new Error("Forbidden: message mapping requires Admin review.");
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      !input.reason.trim() ||
      input.reason.length > 1000
    )
      throw new Error("A mapping revision and confirmation reason are required.");
    return transaction(sql, async (tx) => {
      const [target] = await tx<
        { company_id: string }[]
      >`select company_id from annual_return_cases where id=${input.caseId}`;
      if (!target) throw new Error("Case not found.");
      await subject(
        tx,
        {
          id: input.messageId,
          company_id: target.company_id,
          case_id: input.caseId,
          mapping_revision: 0,
          direction: "inbound",
        },
        true,
      );
      await staff(tx, actor, true);
      const [message] = await tx<
        Message[]
      >`select id,company_id,case_id,mapping_revision,direction from whatsapp_messages where id=${input.messageId} for update`;
      if (!message || message.direction !== "inbound")
        throw new Error("Inbound message not found.");
      if (message.mapping_revision !== input.expectedVersion) {
        const [replay] = await tx<
          { present: boolean }[]
        >`select true present from timeline_events where event_type='whatsapp_message_mapped' and actor_id=${actor.userId!} and metadata->>'messageId'=${input.messageId} and metadata->>'authUserId'=${actor.authUserId} and metadata->>'expectedVersion'=${String(input.expectedVersion)} and metadata->>'reason'=${input.reason} and case_id=${input.caseId} limit 1`;
        if (
          message.mapping_revision === input.expectedVersion + 1 &&
          message.case_id === input.caseId &&
          replay
        )
          return { applied: true, version: message.mapping_revision, idempotentReplay: true };
        throw conflict();
      }
      const media = await tx<
        Media[]
      >`select * from whatsapp_message_media where message_id=${input.messageId} order by id for update`;
      if (media.some((m) => m.document_id || m.intake_intent_id))
        throw new Error(
          "Media intake has started or evidence was received; its case mapping cannot move.",
        );
      await tx`update whatsapp_messages set company_id=${target.company_id},case_id=${input.caseId},mapping_revision=mapping_revision+1 where id=${input.messageId}`;
      await tx`insert into timeline_events(company_id,case_id,event_type,actor_type,actor_id,description,metadata) values(${target.company_id},${input.caseId},'whatsapp_message_mapped','user',${actor.userId!},'Inbound WhatsApp case mapping confirmed.',${tx.json({ messageId: input.messageId, authUserId: actor.authUserId, expectedVersion: input.expectedVersion, previousCaseId: message.case_id, previousCompanyId: message.company_id, reason: input.reason })})`;
      return { applied: true, version: message.mapping_revision + 1, idempotentReplay: false };
    });
  }
  async function mediaPreview(actor: AuthenticatedActor, input: IntakeInput) {
    const [media] = await sql<
      Media[]
    >`select * from whatsapp_message_media where id=${input.mediaId}`;
    if (!media) throw new Error("Media not found.");
    const preview = await getMessagePreview(actor, media.message_id);
    if (preview.version !== input.expectedMappingVersion) throw conflict();
    if (!preview.caseId) throw new Error("Approve a case mapping before media intake.");
    if (media.document_id) return { media, received: await receivedResult(sql, media, true) };
    const [message] = await sql<
      Message[]
    >`select * from whatsapp_messages where id=${media.message_id}`;
    if (!message) throw new Error("Inbound message not found.");
    assertStaffDocumentAccess(actor, await subject(sql, message));
    if (media.provider_media_kind !== "file")
      throw new Error(
        "Legacy waMediaId cannot use the current file API; request a universal fileId from the provider.",
      );
    return { media, received: null };
  }
  async function lockMedia(tx: Tx, actor: AuthenticatedActor, input: IntakeInput) {
    const [candidate] = await tx<
      Media[]
    >`select * from whatsapp_message_media where id=${input.mediaId}`;
    if (!candidate) throw new Error("Media not found.");
    const [original] = await tx<
      Message[]
    >`select * from whatsapp_messages where id=${candidate.message_id}`;
    if (!original) throw new Error("Inbound message not found.");
    const scope = await subject(tx, original, true);
    await staff(tx, actor, true);
    assertStaffDocumentAccess(actor, scope);
    const [message] = await tx<
      Message[]
    >`select * from whatsapp_messages where id=${original.id} for update`;
    const [media] = await tx<
      Media[]
    >`select * from whatsapp_message_media where id=${input.mediaId} for update`;
    if (
      !message ||
      !media ||
      message.direction !== "inbound" ||
      message.mapping_revision !== input.expectedMappingVersion ||
      message.company_id !== original.company_id ||
      message.case_id !== original.case_id ||
      media.provider_media_kind !== "file"
    )
      throw conflict();
    return { message, media, scope };
  }
  async function prepare(actor: AuthenticatedActor, input: IntakeInput, downloaded: Downloaded) {
    return transaction(sql, async (tx) => {
      const { media, scope } = await lockMedia(tx, actor, input);
      if (media.document_id)
        return { received: await receivedResult(tx, media, true), intentId: null };
      if (downloaded.fileId !== media.provider_media_id)
        throw new Error("Downloaded media identity does not match the message.");
      const deps = dependencies(tx);
      if (media.intake_intent_id) {
        const intent = await deps.repository.getUploadIntent(media.intake_intent_id);
        if (!intent || intent.status !== "created" || Date.parse(intent.expiresAt) <= Date.now())
          throw new Error(
            "Intake intent is expired or changed; obtain a reviewed recovery decision.",
          );
        if (
          intent.category !== input.category ||
          intent.checklistItemId !== (input.checklistItemId ?? null) ||
          intent.checksum !== downloaded.checksum ||
          intent.contentType !== downloaded.contentType ||
          intent.expectedSizeBytes !== downloaded.sizeBytes
        )
          throw conflict();
        return { received: null, intentId: intent.id };
      }
      const extension = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" }[
        downloaded.contentType
      ];
      const intent = await createDocumentUploadIntentForActor(
        actor,
        {
          companyId: scope.companyId,
          caseId: scope.caseId!,
          checklistItemId: input.checklistItemId,
          category: input.category,
          fileName: `whatsapp-${media.id}.${extension}`,
          contentType: downloaded.contentType,
          sizeBytes: downloaded.sizeBytes,
          checksum: downloaded.checksum,
        },
        deps,
      );
      await tx`update whatsapp_message_media set intake_intent_id=${intent.id} where id=${media.id}`;
      return { received: null, intentId: intent.id };
    });
  }
  async function finish(
    actor: AuthenticatedActor,
    input: IntakeInput,
    intentId: string,
    body: Uint8Array,
  ) {
    return transaction(sql, async (tx) => {
      const { media, message, scope } = await lockMedia(tx, actor, input);
      if (media.document_id) return receivedResult(tx, media, true);
      if (media.intake_intent_id !== intentId) throw conflict();
      const document = await finalizeDocumentUploadForActor(
        actor,
        intentId,
        body,
        dependencies(tx),
      );
      await tx`update whatsapp_message_media set document_id=${document.id} where id=${media.id}`;
      await tx`insert into timeline_events(company_id,case_id,event_type,actor_type,actor_id,description,metadata) values(${scope.companyId},${scope.caseId},'whatsapp_media_received','user',${actor.userId!},'WhatsApp attachment received into quarantine; scanning and review are required.',${tx.json({ messageId: message.id, mediaId: media.id, intentId, documentId: document.id, documentVersionId: document.currentVersionId, authUserId: actor.authUserId, mappingVersion: message.mapping_revision })})`;
      return {
        status: "received" as const,
        documentId: document.id,
        documentVersionId: document.currentVersionId!,
        uploadStatus: document.uploadStatus,
        idempotentReplay: false,
      };
    });
  }
  return { getMessagePreview, mapMessage, mediaPreview, prepare, finish };
}
async function receivedResult(sql: Query, media: Media, replay: boolean) {
  const [received] = await sql<
    {
      document_id: string;
      version_id: string;
      status: "quarantined" | "available" | "rejected" | "expired" | "failed";
    }[]
  >`
    select d.id document_id,v.id version_id,i.status from document_upload_intents i
    join document_versions v on v.intent_id=i.id and v.document_id=i.document_id
    join documents d on d.id=v.document_id and d.company_id=i.company_id and d.case_id is not distinct from i.case_id
    where i.id=${media.intake_intent_id} and d.id=${media.document_id}`;
  if (!received)
    throw new Error("Received media lineage is missing; obtain a reviewed recovery decision.");
  return {
    status: "received" as const,
    documentId: received.document_id,
    documentVersionId: received.version_id,
    uploadStatus: received.status,
    idempotentReplay: replay,
  };
}
export type WhatsAppIntakeRepository = ReturnType<typeof createWhatsAppIntakeRepository>;
