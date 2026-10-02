import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import { createChecklistTemplateRepository } from "./repository";
const url = process.env.TEST_DATABASE_URL,
  sql = url ? createSqlClient(url, { max: 1 }) : null;
afterAll(async () => {
  await sql?.end();
});
describe.skipIf(!url)("actual Postgres template version snapshots", () => {
  it("new cases use the current template revision; editing never rewrites old case evidence", async () => {
    const rollback = new Error("Owned template rollback");
    await expect(
      sql!.begin(async (tx) => {
        const [actor] = await tx<
          { id: string; team_id: string }[]
        >`select id,team_id from users where role='Admin' and active order by id limit 1`;
        const id = crypto.randomUUID(),
          companyId = crypto.randomUUID();
        await tx`insert into checklist_templates(id,name,service_type,documents) values(${id},${"Owned version " + id},'Annual Return — Private Ltd',${tx.json([{ id: "v1doc", label: "Original document", required: true, daysBeforeDue: 7 }])})`;
        const templates = createChecklistTemplateRepository({ sql: tx });
        const first = (await templates.listTemplates()).find((t) => t.id === id)!;
        expect(first).toMatchObject({ revision: 1 });
        await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id) values(${companyId},'Owned template snapshot',${companyId},${companyId},'2020-01-01','2026-10-01','Local','Local','active',${actor.id},${actor.team_id})`;
        const cases = createAnnualReturnRepository({ sql: tx }),
          created = await cases.createCaseRecord({
            companyId,
            templateId: id,
            ownerId: actor.id,
            actorId: actor.id,
            invoiceNumber: companyId,
            feeAmount: 100,
          });
        const second = await templates.updateTemplate(
          id,
          {
            documents: [{ id: "v2doc", label: "New document", required: true, daysBeforeDue: 14 }],
          },
          1,
        );
        expect(second).toMatchObject({ revision: 2 });
        await expect(
          templates.updateTemplate(id, { description: "stale overwrite" }, 1),
        ).rejects.toMatchObject({ statusCode: 409 });
        const [snapshot] =
          await tx`select checklist_template_revision,checklist_template_snapshot from annual_return_cases where id=${created.id}`;
        expect(snapshot.checklist_template_revision).toBe(1);
        expect(snapshot.checklist_template_snapshot.documents[0].label).toBe("Original document");
        const items =
          await tx`select item_label from annual_return_checklist_items where case_id=${created.id}`;
        expect(items.map((x) => x.item_label)).toEqual(["Original document"]);
        const impact = await templates.previewCaseMigration(id);
        expect(impact.cases.find((x) => x.caseId === created.id)).toMatchObject({
          fromRevision: 1,
          toRevision: 2,
          added: ["New document"],
          removed: ["Original document"],
        });
        const [unchanged] =
          await tx`select item_label from annual_return_checklist_items where case_id=${created.id}`;
        expect(unchanged.item_label).toBe("Original document");
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
