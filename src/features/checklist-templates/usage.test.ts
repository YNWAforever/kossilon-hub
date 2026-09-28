import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createChecklistTemplateRepository } from "./repository";
import { applyTemplateVersionToCaseForActor } from "./rollout";
import type { AuthenticatedActor } from "@/features/auth/types";
import { listTemplateUsageForActor, previewTemplateRolloutForActor } from "./usage";

const admin: AuthenticatedActor = {
  authUserId: "admin-auth",
  userId: "20000000-0000-0000-0000-000000000001",
  role: "Admin",
  teamId: null,
  active: true,
};

describe("T21 real template usage and rollout", () => {
  it("t21_scenario_1 counts only linked case snapshots and labels legacy usage unknown", async () => {
    const usage = await listTemplateUsageForActor(
      admin,
      { templateVersionId: "10000000-0000-0000-0000-000000000001", cursor: null },
      {
        listCaseSnapshots: async () => [
          {
            caseId: "30000000-0000-0000-0000-000000000001",
            companyName: "Example",
            versionId: "10000000-0000-0000-0000-000000000001",
            status: "Documents pending",
          },
          {
            caseId: "30000000-0000-0000-0000-000000000002",
            companyName: "Legacy",
            versionId: null,
            status: "Documents pending",
          },
        ],
      },
    );
    expect(usage.items.map((item) => item.caseId)).toEqual([
      "30000000-0000-0000-0000-000000000001",
    ]);
    expect(usage.unknownLegacyCount).toBe(1);
  });

  it("pages linked usage without mixing unknown legacy cases into the selected version", async () => {
    const templateVersionId = "10000000-0000-0000-0000-000000000001";
    const linked = Array.from({ length: 51 }, (_, index) => ({
      caseId: `30000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      companyName: `Company ${index + 1}`,
      versionId: templateVersionId,
      status: "Documents pending",
    }));
    const listCaseSnapshots = async () => [
      ...linked,
      {
        caseId: "30000000-0000-0000-0000-000000000099",
        companyName: "Legacy",
        versionId: null,
        status: "Documents pending",
      },
    ];
    const first = await listTemplateUsageForActor(
      admin,
      { templateVersionId, cursor: null },
      { listCaseSnapshots },
    );
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(linked[49]!.caseId);
    expect(first.unknownLegacyCount).toBe(1);
    const second = await listTemplateUsageForActor(
      admin,
      { templateVersionId, cursor: first.nextCursor },
      { listCaseSnapshots },
    );
    expect(second.items.map((item) => item.caseId)).toEqual([linked[50]!.caseId]);
    expect(second.nextCursor).toBeNull();
  });

  it("t21_scenario_2 previews a new required document as not ready without changing verified evidence", async () => {
    const preview = await previewTemplateRolloutForActor(
      admin,
      {
        fromVersion: "10000000-0000-0000-0000-000000000001",
        toVersion: "10000000-0000-0000-0000-000000000002",
        selection: { kind: "ids", ids: ["30000000-0000-0000-0000-000000000001"] },
      },
      {
        loadVersions: async () => [
          {
            id: "10000000-0000-0000-0000-000000000001",
            templateId: "40000000-0000-0000-0000-000000000001",
            documents: [{ id: "passport", label: "Passport", required: true, daysBeforeDue: 0 }],
          },
          {
            id: "10000000-0000-0000-0000-000000000002",
            templateId: "40000000-0000-0000-0000-000000000001",
            documents: [
              { id: "passport", label: "Passport", required: true, daysBeforeDue: 0 },
              { id: "address", label: "Address proof", required: true, daysBeforeDue: 0 },
            ],
          },
        ],
        loadCases: async () => [
          {
            caseId: "30000000-0000-0000-0000-000000000001",
            versionId: "10000000-0000-0000-0000-000000000001",
            revision: 1,
            status: "Documents pending",
            packageDelivered: false,
            items: [{ documentId: "passport", status: "Verified", evidenceId: "evidence-1" }],
          },
        ],
      },
    );
    expect(preview.items[0]).toMatchObject({
      state: "eligible",
      addedRequired: ["address"],
      readyAfter: false,
    });
    expect(preview.items[0]?.preservedEvidenceIds).toEqual(["evidence-1"]);
  });

  it("excludes released packages and flags changed verified requirements", async () => {
    const first = "30000000-0000-0000-0000-000000000011";
    const second = "30000000-0000-0000-0000-000000000012";
    const fromVersion = "10000000-0000-0000-0000-000000000011";
    const toVersion = "10000000-0000-0000-0000-000000000012";
    const preview = await previewTemplateRolloutForActor(
      admin,
      { fromVersion, toVersion, selection: { kind: "ids", ids: [first, second] } },
      {
        loadVersions: async () => [
          {
            id: fromVersion,
            templateId: "40000000-0000-0000-0000-000000000001",
            documents: [{ id: "passport", label: "Passport", required: true, daysBeforeDue: 0 }],
          },
          {
            id: toVersion,
            templateId: "40000000-0000-0000-0000-000000000001",
            documents: [
              { id: "passport", label: "Renamed proof", required: true, daysBeforeDue: 0 },
            ],
          },
        ],
        loadCases: async () => [
          {
            caseId: first,
            versionId: fromVersion,
            revision: 1,
            status: "Documents pending",
            packageDelivered: false,
            items: [{ documentId: "passport", status: "Verified", evidenceId: "e1" }],
          },
          {
            caseId: second,
            versionId: fromVersion,
            revision: 1,
            status: "Documents pending",
            packageDelivered: true,
            items: [{ documentId: "passport", status: "Verified", evidenceId: "e2" }],
          },
        ],
      },
    );
    expect(preview.items.map((item) => item.state)).toEqual(["conflict", "skipped"]);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("T21 disposable PostgreSQL version lifecycle", () => {
  it("t21_scenario_2 applies a new required document, preserves verified evidence, and rejects a stale editor", async () => {
    const db = createSqlClient(databaseUrl!, { max: 2 });
    const rollback = new Error("T21 fixture rollback");
    try {
      await expect(
        db.begin(async (tx) => {
          const teamId = crypto.randomUUID();
          const adminId = crypto.randomUUID();
          const authUserId = `t21-${adminId}`;
          const companyId = crypto.randomUUID();
          const caseId = crypto.randomUUID();
          const templateId = crypto.randomUUID();
          const evidenceId = crypto.randomUUID();
          const actor: AuthenticatedActor = {
            authUserId,
            userId: adminId,
            role: "Admin",
            teamId,
            active: true,
          };
          await tx`insert into teams(id,name) values (${teamId},${`T21 ${teamId}`})`;
          await tx`insert into users(id,name,email,role,team_id)
          values (${adminId},'T21 Admin',${`${adminId}@example.invalid`},'Admin',${teamId})`;
          await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id)
          values (${adminId},${authUserId},'Admin',${teamId})`;
          await tx`insert into companies(id,company_name,cr_number,br_number,
          incorporation_date,annual_return_basis_date,registered_office,
          company_secretary,assigned_owner_id,assigned_team_id,data_origin)
          values (${companyId},'T21 Case',${`CR-${companyId}`},${`BR-${companyId}`},
            '2020-01-01','2026-01-01','Test address','Test secretary',
            ${adminId},${teamId},'fixture')`;
          const passport = { id: "passport", label: "Passport", required: true, daysBeforeDue: 0 };
          const address = {
            id: "address",
            label: "Address proof",
            required: true,
            daysBeforeDue: 0,
          };
          await tx`insert into checklist_templates(id,name,service_type,active,documents)
          values (${templateId},${`T21 ${templateId}`},'Annual Return — Private Ltd',
            false,${tx.json([passport])})`;
          const repo = createChecklistTemplateRepository({ sql: tx });
          const first = await repo.publishTemplate(templateId, 1, adminId, authUserId);
          const v1 = first.publishedVersionId!;
          await expect(
            repo.publishTemplate(templateId, first.revision!, adminId, authUserId),
          ).rejects.toThrow(/No unpublished template changes/i);
          const edited = await repo.updateTemplate(
            templateId,
            { documents: [passport, address] },
            first.revision!,
          );
          await expect(
            repo.updateTemplate(templateId, { name: "Stale edit" }, first.revision!),
          ).rejects.toThrow(/revision changed/i);
          const second = await repo.publishTemplate(
            templateId,
            edited!.revision!,
            adminId,
            authUserId,
          );
          const v2 = second.publishedVersionId!;
          await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,
          filing_due_date,current_status,owner_id,template_version_id)
          values (${caseId},${companyId},2026,'2026-01-01','2026-02-11',
            'Documents pending',${adminId},${v1})`;
          await tx`insert into documents(id,company_id,case_id,file_type,file_name,storage_url,
          upload_source,verification_status,uploaded_by,verified_by,verified_at)
          values (${evidenceId},${companyId},${caseId},'identity','passport.pdf',
            'r2://t21/passport.pdf','staff','verified',${adminId},${adminId},now())`;
          await tx`insert into annual_return_checklist_items
          (case_id,item_label,required,status,due_date,received_at,verified_at,
            document_id,template_document_id)
          values (${caseId},'Passport',true,'Verified','2026-02-11',now(),now(),
            ${evidenceId},'passport')`;
          const preview = await previewTemplateRolloutForActor(
            actor,
            {
              fromVersion: v1,
              toVersion: v2,
              selection: { kind: "ids", ids: [caseId] },
            },
            { sql: tx },
          );
          expect(preview.items[0]).toMatchObject({
            state: "eligible",
            addedRequired: ["address"],
            readyAfter: false,
            preservedEvidenceIds: [evidenceId],
          });
          const result = await applyTemplateVersionToCaseForActor(
            actor,
            {
              caseId,
              fromVersion: v1,
              toVersion: v2,
              expectedRevision: 1,
            },
            { sql: tx },
          );
          expect(result).toMatchObject({
            revision: 2,
            addedRequired: ["address"],
            readyAfter: false,
          });
          const rows = await tx<
            {
              template_document_id: string;
              status: string;
              document_id: string | null;
              required: boolean;
            }[]
          >`
          select template_document_id,status,document_id,required
          from annual_return_checklist_items where case_id=${caseId}
          order by template_document_id`;
          expect(rows).toEqual([
            {
              template_document_id: "address",
              status: "Missing",
              document_id: null,
              required: true,
            },
            {
              template_document_id: "passport",
              status: "Verified",
              document_id: evidenceId,
              required: true,
            },
          ]);
          await expect(
            applyTemplateVersionToCaseForActor(
              actor,
              {
                caseId,
                fromVersion: v1,
                toVersion: v2,
                expectedRevision: 1,
              },
              { sql: tx },
            ),
          ).rejects.toThrow(/revision changed/i);
          const usage = await listTemplateUsageForActor(
            actor,
            { templateVersionId: v2, cursor: null },
            { sql: tx },
          );
          expect(usage.items).toEqual([
            expect.objectContaining({ caseId, companyName: "T21 Case" }),
          ]);
          await repo.deleteTemplate(templateId);
          const [archived] = await tx<{ active: boolean; archived_at: Date | null }[]>`
            select active,archived_at from checklist_templates where id=${templateId}`;
          expect(archived.active).toBe(false);
          expect(archived.archived_at).not.toBeNull();
          expect(
            (
              await listTemplateUsageForActor(
                actor,
                { templateVersionId: v2, cursor: null },
                { sql: tx },
              )
            ).items,
          ).toEqual([expect.objectContaining({ caseId })]);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await db.end();
    }
  }, 60_000);
});
