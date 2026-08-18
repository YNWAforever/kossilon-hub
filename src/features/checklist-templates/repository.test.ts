import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createChecklistTemplateRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

let testSql: SqlClient | undefined;

async function cleanup() {
  if (!testSql) return;
  // 'Untitled template' is the fixed name every createTemplate() call inserts (see
  // repository.ts) — it must be cleaned up alongside 'Test template%' rows, or a second
  // createTemplate() call in a later test collides with a prior test's un-renamed row on
  // checklist_templates.name's unique constraint.
  await testSql`delete from checklist_templates where name like 'Test template%' or name = 'Untitled template'`;
}

afterAll(async () => {
  await testSql?.end();
});

describe.skipIf(!databaseUrl)("checklist template repository", () => {
  beforeEach(async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for this suite.");
    testSql ??= createSqlClient(databaseUrl, { max: 1 });
    await cleanup();
  });

  it("creates a template with empty lists and reads it back", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });

    const created = await repository.createTemplate("Annual Return — Private Ltd");
    const all = await repository.listTemplates();
    const found = all.find((t) => t.id === created.id);

    expect(found).toMatchObject({
      name: "Untitled template",
      documents: [],
      reminders: [],
      riskRules: [],
    });

    await repository.close();
  });

  it("round-trips documents/reminders/riskRules through jsonb without losing shape", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");

    const updated = await repository.updateTemplate(created.id, {
      name: "Test template round-trip",
      documents: [{ id: "d1", label: "Doc one", required: true, daysBeforeDue: 5 }],
      reminders: [{ id: "r1", label: "Rem one", daysBeforeDue: 10, channel: "Email" }],
      riskRules: [{ id: "k1", label: "Risk one", severity: "High", trigger: "x", enabled: true }],
    });

    expect(updated?.documents).toEqual([
      { id: "d1", label: "Doc one", required: true, daysBeforeDue: 5 },
    ]);
    expect(updated?.reminders).toEqual([
      { id: "r1", label: "Rem one", daysBeforeDue: 10, channel: "Email" },
    ]);
    expect(updated?.riskRules).toEqual([
      { id: "k1", label: "Risk one", severity: "High", trigger: "x", enabled: true },
    ]);

    await repository.close();
  });

  it("leaves unpatched fields untouched", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");

    const updated = await repository.updateTemplate(created.id, { active: false });

    expect(updated?.name).toBe("Untitled template");
    expect(updated?.active).toBe(false);

    await repository.close();
  });

  it("duplicates a template with fresh item ids", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");
    await repository.updateTemplate(created.id, {
      name: "Test template dup-source",
      documents: [{ id: "orig-1", label: "Doc", required: true, daysBeforeDue: 1 }],
    });

    const duplicated = await repository.duplicateTemplate(created.id);

    expect(duplicated?.name).toBe("Test template dup-source (copy)");
    expect(duplicated?.documents[0]?.id).not.toBe("orig-1");
    expect(duplicated?.documents[0]?.label).toBe("Doc");

    await repository.close();
  });

  it("deletes a template", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");

    await repository.deleteTemplate(created.id);
    const all = await repository.listTemplates();

    expect(all.find((t) => t.id === created.id)).toBeUndefined();

    await repository.close();
  });

  it("returns updatedAt as a string, not a Date object", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");

    expect(typeof created.updatedAt).toBe("string");
    expect(() => new Date(created.updatedAt).toISOString()).not.toThrow();

    await repository.close();
  });
});
