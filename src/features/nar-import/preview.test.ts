import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { readNarSheet } from "./mapping";
import { createNarImportRepository } from "./repository";
import type { WorkbookCell, WorkbookSheet } from "./xlsx/workbook";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = databaseUrl ? createSqlClient(databaseUrl, { max: 3 }) : null;
function cell(
  column: string,
  row: number,
  text: string,
  numeric?: number,
  fromFormula = false,
): WorkbookCell {
  return {
    ref: `${column}${row}`,
    column,
    row,
    type: numeric === undefined ? "s" : "n",
    raw: text,
    text,
    ...(numeric === undefined ? {} : { numeric }),
    dateFormatted: numeric !== undefined,
    fromFormula,
  };
}
function sheet(externalId: string, companyName: string): WorkbookSheet {
  const labels = new Map<string, WorkbookCell>();
  for (const [column, label] of Object.entries({
    B: "Client ID",
    C: "Name",
    D: "Date of Incorp",
    E: "Invoice no.",
    F: "Payment Rcvd Date",
    G: "AR Due Date",
    H: "BR Due Date",
  }))
    labels.set(column, cell(column, 1, label));
  return {
    name: "8.2025",
    rows: new Map([
      [1, labels],
      [
        2,
        new Map([
          ["B", cell("B", 2, externalId)],
          ["C", cell("C", 2, companyName)],
          ["D", cell("D", 2, "02/08")],
          ["E", cell("E", 2, "(Nil)")],
          ["F", cell("F", 2, "27/8/2025 (deposit)")],
          ["G", cell("G", 2, "45913", 45913)],
          ["H", cell("H", 2, "45905", 45905, true)],
        ]),
      ],
    ]),
  };
}
function randomHash(): string {
  return crypto.randomUUID().replaceAll("-", "").repeat(2);
}

describe.skipIf(!databaseUrl)("T10 monthly import preview", () => {
  afterAll(async () => {
    await sql?.end();
  });

  it("t10_scenario_1 searches all three existing companies without new-case eligibility", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const repository = createNarImportRepository({ sql });
    const companies = await sql<{ id: string }[]>`select id from companies order by id`;
    expect(companies).toHaveLength(3);
    const page = await repository.searchCompanies({ q: "", cursor: null, limit: 20 });
    expect(page.items.map((item) => item.id).sort()).toEqual(companies.map((item) => item.id));
    expect(page.items.every((item) => item.crNumber)).toBe(true);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const next = await repository.searchCompanies({ q: "", cursor, limit: 1 });
      seen.push(...next.items.map((item) => item.id));
      cursor = next.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual(companies.map((item) => item.id));
  });

  it("t10_scenario_2 separates years, refreshes mapping and repairs legacy without reupload", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const [admin] = await sql<{ user_id: string }[]>`
      select sp.user_id from staff_profiles sp join users u on u.id = sp.user_id and u.active
      where sp.role = 'Admin' and sp.active limit 1`;
    const [company] = await sql<{ id: string; company_name: string }[]>`
      select id,company_name from companies order by id limit 1`;
    const externalId = `T10-${crypto.randomUUID()}`;
    const read = readNarSheet(sheet(externalId, company.company_name), false);
    const hash = randomHash();
    const repository = createNarImportRepository({ sql });
    const stage = (returnYear: number, sourceSha256 = hash) =>
      repository.stageBatch({
        sourceFileName: "monthly.xlsx",
        sourceSha256,
        sourceSizeBytes: 100,
        parserVersion: "kossilon-xlsx-1",
        returnYear,
        createdBy: admin.user_id,
        read,
      });
    try {
      const first = await stage(2025);
      const second = await stage(2026);
      expect(second.reused).toBe(false);
      expect(second.batch.id).not.toBe(first.batch.id);
      const replay = await stage(2025);
      expect(replay.reused).toBe(true);
      expect(replay.batch.id).toBe(first.batch.id);
      expect((await repository.countByDisposition(first.batch.id)).needsCompanyMapping).toBe(1);
      await repository.mapExternalReference({
        externalClientId: externalId,
        companyId: company.id,
        mappedBy: admin.user_id,
      });
      const [otherCompany] = await sql<{ id: string }[]>`
        select id from companies where id <> ${company.id} order by id limit 1`;
      await expect(
        repository.mapExternalReference({
          externalClientId: externalId,
          companyId: otherCompany.id,
          mappedBy: admin.user_id,
        }),
      ).rejects.toThrow(/Mapping conflict/);
      const refreshed = await repository.getBatch(first.batch.id);
      expect(refreshed!.revision).toBeGreaterThan(first.batch.revision);
      expect((await repository.countByDisposition(first.batch.id)).needsCompanyMapping).toBe(0);
      await expect(
        repository.revalidate(first.batch.id, admin.user_id, first.batch.revision),
      ).rejects.toThrow(/stale/i);
      const preview = await repository.revalidate(
        first.batch.id,
        admin.user_id,
        refreshed!.revision,
      );
      expect(preview.counts.needsCompanyMapping).toBe(0);
      expect(preview.semanticKey).toContain("2025");
      expect(preview.rows[0].matchedCompanyId).toBe(company.id);
      expect(preview.rows[0].fields.find((field) => field.field === "filingDueDate")?.source).toBe(
        "workbook:G2",
      );
      expect(
        preview.rows[0].fields.find((field) => field.field === "paymentObservedDate")?.policy,
      ).toBe("observation-only");
      expect(
        preview.rows[0].fields.find((field) => field.field === "invoiceReference")?.after,
      ).toBeNull();
      await sql`update nar_import_batches set return_year = null, semantic_key = null
        where id = ${first.batch.id}`;
      await sql`update nar_import_rows set matched_company_id = null,
        disposition = 'needs_company_mapping' where batch_id = ${first.batch.id}`;
      await expect(
        repository.revalidate(first.batch.id, admin.user_id, refreshed!.revision),
      ).rejects.toThrow(/explicit return year/i);
      const repaired = await repository.revalidate(
        first.batch.id,
        admin.user_id,
        refreshed!.revision,
        2025,
      );
      expect(repaired.counts.needsCompanyMapping).toBe(0);
      expect(repaired.rows[0].matchedCompanyId).toBe(company.id);
      await sql`insert into nar_import_rows (
        batch_id,row_number,external_client_id,company_name,raw,parsed,issues,
        source_issues,disposition,matched_company_id
      ) select r.batch_id,n,r.external_client_id,r.company_name,r.raw,r.parsed,r.issues,
        r.source_issues,r.disposition,r.matched_company_id
        from nar_import_rows r cross join generate_series(3,61) n
        where r.batch_id = ${first.batch.id} and r.row_number = 2`;
      const pageOne = await repository.listRowsPage(first.batch.id, null, 50);
      expect(pageOne.items).toHaveLength(50);
      expect(pageOne.nextCursor).toBe(51);
      const pageTwo = await repository.listRowsPage(first.batch.id, pageOne.nextCursor, 50);
      expect(pageTwo.items).toHaveLength(10);
      expect(pageTwo.nextCursor).toBeNull();
    } finally {
      await sql`delete from company_external_references where source_system = 'nar-monthly-workbook'
        and external_client_id = ${externalId}`;
      await sql`delete from nar_import_previews where batch_id in (
        select id from nar_import_batches where source_sha256 = ${hash})`;
      await sql`delete from nar_import_batches where source_sha256 = ${hash}`;
    }
  });

  it("t10_scenario_3 retains serial, text, Nil, formula and duplicate-ID issues", () => {
    const read = readNarSheet(sheet("T10-ID", "Same Name Limited"), false);
    const row = read.rows[0];
    expect(row.arDue.kind).toBe("serial");
    expect(row.paymentReceived.kind).toBe("text");
    expect(row.invoice.kind).toBe("nil");
    expect(row.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "nil-marker",
        "date-arrived-as-text",
        "date-carries-note",
        "value-computed-by-workbook",
      ]),
    );
    const duplicateSheet = sheet("T10-DUP", "Similar Name Limited");
    duplicateSheet.rows.set(
      3,
      new Map([
        ["B", cell("B", 3, "T10-DUP")],
        ["C", cell("C", 3, "Similar Name Ltd")],
        ["G", cell("G", 3, "45913", 45913)],
      ]),
    );
    const duplicate = readNarSheet(duplicateSheet, false);
    expect(duplicate.rows).toHaveLength(2);
    expect(
      duplicate.rows.every((entry) =>
        entry.issues.some(
          (issue) => issue.code === "duplicate-client-id" && issue.severity === "blocking",
        ),
      ),
    ).toBe(true);
  });
});
