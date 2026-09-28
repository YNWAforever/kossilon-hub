import "dotenv/config";
import type postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentStorage } from "@/features/documents/types";
import { createDocumentRepository } from "@/features/documents/repository";
import { downloadDocumentForActor } from "@/features/documents/server-fns";
import { assertStaffDocumentAccess } from "@/features/documents/authorization";
import { correctInboundMediaClassificationForActor, linkInboundMediaForActor } from "./media-link";

const url = process.env.TEST_DATABASE_URL;
const db: SqlClient | null = url ? createSqlClient(url, { max: 2 }) : null;
afterAll(async () => {
  await db?.end();
});
const rollback = new Error("t19-rollback");
function storageForTest(body: Uint8Array, objectKey: string, checksum: string): DocumentStorage {
  return {
    async put() {
      throw new Error("Fixture already has quarantined bytes.");
    },
    async get(key) {
      return key === objectKey
        ? {
            objectKey,
            body: Uint8Array.from(body).buffer,
            checksum,
            contentType: "application/pdf",
            sizeBytes: body.byteLength,
          }
        : null;
    },
    async head(key) {
      return key === objectKey
        ? {
            objectKey,
            checksum,
            contentType: "application/pdf",
            sizeBytes: body.byteLength,
          }
        : null;
    },
    async delete() {
      throw new Error("Fixture never deletes evidence.");
    },
  };
}
async function fixture(
  work: (x: {
    tx: postgres.TransactionSql;
    actor: AuthenticatedActor;
    caseId: string;
    messageId: string;
    otherCaseId: string;
    requirementId: string;
    secondRequirementId: string;
    storage: DocumentStorage;
  }) => Promise<void>,
) {
  if (!db) throw new Error("TEST_DATABASE_URL required.");
  try {
    await db.begin(async (tx) => {
      const userId = crypto.randomUUID(),
        teamId = crypto.randomUUID();
      const companyId = crypto.randomUUID(),
        caseId = crypto.randomUUID();
      const otherCaseId = crypto.randomUUID(),
        messageId = crypto.randomUUID();
      const requirementId = crypto.randomUUID(),
        secondRequirementId = crypto.randomUUID();
      const phone = "+8526" + String(Math.floor(Math.random() * 10000000)).padStart(7, "0");
      const bytes = new TextEncoder().encode("%PDF-1.7\nT19 inbound");
      const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
      const checksum = Array.from(new Uint8Array(digest), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
      const objectKey = "whatsapp-media/" + crypto.randomUUID();
      await tx`insert into teams(id,name) values (${teamId},${"t19-" + teamId})`;
      await tx`insert into users(id,name,email,role,team_id)
      values (${userId},'T19 staff',${userId + "@example.invalid"},'Staff',${teamId})`;
      await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,
      annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,
      assigned_team_id,data_origin)
      values (${companyId},'T19 fixture',${companyId},${companyId},'2020-01-01',
      '2020-01-01','Fixture office','Fixture secretary',${userId},${teamId},'client')`;
      for (const id of [caseId, otherCaseId])
        await tx`insert into annual_return_cases(
      id,company_id,return_year,made_up_date,filing_due_date,current_status,owner_id)
      values (${id},${companyId},${id === caseId ? 2026 : 2027},'2026-01-01',
        '2026-02-01','Documents pending',${userId})`;
      await tx`insert into company_contacts(company_id,name,role,phone,phone_e164,
      phone_verified_at,phone_verified_by,phone_verification_evidence)
      values (${companyId},'T19 director','Director',${phone},${phone},now(),${userId},
        'Confirmed in fixture call')`;
      const [contact] = await tx<
        { id: string }[]
      >`insert into whatsapp_contacts(phone_e164,company_id)
      values (${phone},${companyId}) returning id`;
      await tx`insert into whatsapp_messages(id,provider_message_id,direction,status,
      contact_id,company_id,case_id,phone_e164,body,received_at)
      values (${messageId},${"t19-" + messageId},'inbound','received',
        ${contact.id},${companyId},${caseId},${phone.slice(1)},'[document]',now())`;
      for (const [i, id] of [requirementId, secondRequirementId].entries()) {
        const [item] = await tx<{ id: string }[]>`insert into annual_return_checklist_items(
        case_id,item_label,due_date) values (${caseId},${"T19 item " + i},'2026-02-01') returning id`;
        await tx`insert into case_requirement_instances(id,case_id,checklist_item_id,
        requirement_key,template_version) values (${id},${caseId},${item.id},
          ${"t19-key-" + i},'t19-test')`;
      }
      await tx`insert into whatsapp_message_media(message_id,provider_media_id,media_type,
      position,download_status,download_object_key,download_checksum_sha256,
      download_content_type,download_byte_size,download_file_name,download_revision)
      values (${messageId},'file-1','DOCUMENT',0,'quarantined',${objectKey},${checksum},
        'application/pdf',${bytes.byteLength},'inbound.pdf',1)`;
      await work({
        tx,
        actor: { authUserId: userId, userId, role: "Staff", teamId, active: true },
        caseId,
        messageId,
        otherCaseId,
        requirementId,
        secondRequirementId,
        storage: storageForTest(bytes, objectKey, checksum),
      });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

describe.skipIf(!url)("T19 inbound media case link", () => {
  it("t19_scenario_1 links once and replays without a duplicate document version", async () => {
    await fixture(async ({ tx, actor, caseId, messageId, otherCaseId, requirementId, storage }) => {
      const input = {
        messageId,
        mediaIndex: 0,
        caseId,
        requirementInstanceId: requirementId,
        expectedRevision: 1,
      };
      const first = await linkInboundMediaForActor(actor, input, { sql: tx, storage });
      expect(first.documentId).toBeTruthy();
      expect((await linkInboundMediaForActor(actor, input, { sql: tx, storage })).documentId).toBe(
        first.documentId,
      );
      const [counts] = await tx<{ documents: number; versions: number; scans: number }[]>`
        select (select count(*)::int from documents where id=${first.documentId}) documents,
          (select count(*)::int from document_versions where document_id=${first.documentId}) versions,
          (select count(*)::int from document_scan_jobs where intent_id in
            (select id from document_upload_intents where document_id=${first.documentId})) scans`;
      expect(counts).toEqual({ documents: 1, versions: 1, scans: 1 });
      await expect(
        linkInboundMediaForActor(actor, { ...input, caseId: otherCaseId }, { sql: tx, storage }),
      ).rejects.toThrow();
      const docs = createDocumentRepository({ sql: tx });
      await expect(
        downloadDocumentForActor(actor, first.documentId, {
          repository: docs,
          storage,
          authorizeDocument: async (a, s) => {
            assertStaffDocumentAccess(a, s);
          },
          createScanner: () => {
            throw new Error("must not scan in test");
          },
        }),
      ).rejects.toThrow(/quarantined/);
      const [links] = await tx<
        { count: number }[]
      >`select count(*)::int count from requirement_evidence_links
        where document_id=${first.documentId}`;
      expect(links.count).toBe(0);
    });
  });
  it("t19_scenario_2 refuses ambiguous/wrong evidence and audits human requirement correction", async () => {
    await fixture(
      async ({ tx, actor, caseId, messageId, requirementId, secondRequirementId, storage }) => {
        const input = {
          messageId,
          mediaIndex: 0,
          caseId,
          requirementInstanceId: requirementId,
          expectedRevision: 1,
        };
        await tx`update whatsapp_messages set company_id=null,case_id=null,phone_e164=null
        where id=${messageId}`;
        await expect(linkInboundMediaForActor(actor, input, { sql: tx, storage })).rejects.toThrow(
          /contact|phone|company/i,
        );
        const [contact] = await tx<
          { phone_e164: string }[]
        >`select phone_e164 from whatsapp_contacts
        where id=(select contact_id from whatsapp_messages where id=${messageId})`;
        await tx`update whatsapp_messages set phone_e164=${contact.phone_e164} where id=${messageId}`;
        const linked = await linkInboundMediaForActor(actor, input, { sql: tx, storage });
        const [target] = await tx<{ id: string }[]>`select checklist_item_id id
          from case_requirement_instances where id=${secondRequirementId}`;
        await tx`update annual_return_checklist_items set status='Received'
          where id=${target.id}`;
        await expect(
          correctInboundMediaClassificationForActor(
            actor,
            {
              messageId,
              mediaIndex: 0,
              caseId,
              requirementInstanceId: secondRequirementId,
              expectedRevision: linked.revision,
              reason: "Conflicting received item",
            },
            { sql: tx },
          ),
        ).rejects.toThrow(/received|occupied/i);
        await tx`update annual_return_checklist_items set status='Missing'
          where id=${target.id}`;
        const corrected = await correctInboundMediaClassificationForActor(
          actor,
          {
            messageId,
            mediaIndex: 0,
            caseId,
            requirementInstanceId: secondRequirementId,
            expectedRevision: linked.revision,
            reason: "Client confirmed the second item",
          },
          { sql: tx },
        );
        expect(corrected.revision).toBe(linked.revision + 1);
        const [oldItem] = await tx<
          { status: string }[]
        >`select status from annual_return_checklist_items
        where id=(select checklist_item_id from case_requirement_instances where id=${requirementId})`;
        const [newItem] = await tx<
          { status: string }[]
        >`select status from annual_return_checklist_items
        where id=(select checklist_item_id from case_requirement_instances where id=${secondRequirementId})`;
        expect(oldItem.status).toBe("Missing");
        expect(newItem.status).toBe("Received");
        const [audit] = await tx<
          { count: number }[]
        >`select count(*)::int count from timeline_events
        where case_id=${caseId} and event_type='whatsapp_media_classification_corrected'`;
        expect(audit.count).toBe(1);
        await expect(
          correctInboundMediaClassificationForActor(
            actor,
            {
              messageId,
              mediaIndex: 0,
              caseId,
              requirementInstanceId: requirementId,
              expectedRevision: linked.revision,
              reason: "Stale correction",
            },
            { sql: tx },
          ),
        ).rejects.toThrow(/revision/i);
      },
    );
  });
});
