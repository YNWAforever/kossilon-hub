import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type postgres from "postgres";
import { rethrowChecklistTemplateWriteError } from "./errors";
import type {
  ChecklistTemplate,
  ChecklistTemplatePatch,
  DocumentItem,
  ReminderRule,
  RiskRule,
  ServiceType,
  TemplateMigrationPreview,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;

type TemplateRow = {
  id: string;
  name: string;
  service_type: ServiceType;
  description: string;
  active: boolean;
  documents: DocumentItem[];
  reminders: ReminderRule[];
  risk_rules: RiskRule[];
  updated_at: string | Date;
  revision: number;
};

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function mapTemplate(row: TemplateRow): ChecklistTemplate {
  return {
    id: row.id,
    name: row.name,
    serviceType: row.service_type,
    description: row.description,
    active: row.active,
    documents: row.documents,
    reminders: row.reminders,
    riskRules: row.risk_rules,
    updatedAt: iso(row.updated_at),
    revision: row.revision,
  };
}

export type ChecklistTemplateRepository = {
  listTemplates(): Promise<ChecklistTemplate[]>;
  createTemplate(serviceType: ServiceType): Promise<ChecklistTemplate>;
  updateTemplate(
    id: string,
    patch: ChecklistTemplatePatch,
    expectedRevision?: number,
  ): Promise<ChecklistTemplate | null>;
  previewCaseMigration(
    id: string,
    cursor?: string,
    limit?: number,
  ): Promise<TemplateMigrationPreview>;
  duplicateTemplate(id: string): Promise<ChecklistTemplate | null>;
  deleteTemplate(id: string): Promise<void>;
  close(): Promise<void>;
};

export function createChecklistTemplateRepository(
  options?: CreateSqlClientOptions & { sql?: QueryClient },
): ChecklistTemplateRepository;
export function createChecklistTemplateRepository(
  databaseUrl: string,
  options?: CreateSqlClientOptions,
): ChecklistTemplateRepository;
export function createChecklistTemplateRepository(
  databaseUrlOrOptions: string | (CreateSqlClientOptions & { sql?: QueryClient }) = {},
  maybeOptions: CreateSqlClientOptions = {},
): ChecklistTemplateRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const suppliedSql =
    typeof databaseUrlOrOptions === "string" ? undefined : databaseUrlOrOptions.sql;
  const options: CreateSqlClientOptions =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = suppliedSql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !suppliedSql;

  return {
    async listTemplates() {
      const rows = await sql<TemplateRow[]>`
        select * from checklist_templates order by created_at asc
      `;
      return rows.map(mapTemplate);
    },

    async createTemplate(serviceType) {
      try {
        const rows = await sql<TemplateRow[]>`
          insert into checklist_templates (name, service_type, description, active, documents, reminders, risk_rules)
          values ('Untitled template', ${serviceType}, '', true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
          returning *
        `;
        return mapTemplate(rows[0]!);
      } catch (error) {
        rethrowChecklistTemplateWriteError(error);
      }
    },

    async updateTemplate(id, patch, expectedRevision) {
      try {
        const rows = await sql<TemplateRow[]>`
          update checklist_templates
          set
            name = coalesce(${patch.name ?? null}, name),
            service_type = coalesce(${patch.serviceType ?? null}, service_type),
            description = coalesce(${patch.description ?? null}, description),
            active = coalesce(${patch.active ?? null}, active),
            documents = coalesce(${patch.documents ? sql.json(patch.documents) : null}, documents),
            reminders = coalesce(${patch.reminders ? sql.json(patch.reminders) : null}, reminders),
            risk_rules = coalesce(${patch.riskRules ? sql.json(patch.riskRules) : null}, risk_rules),
            revision = revision + 1,
            updated_at = now()
          where id = ${id} and (${expectedRevision ?? null}::int is null or revision=${expectedRevision ?? null}::int)
          returning *
        `;
        if (!rows[0] && expectedRevision !== undefined) {
          const [existing] = await sql`select id from checklist_templates where id=${id}`;
          if (existing)
            throw Object.assign(new Error("Template revision changed; reload before retrying."), {
              statusCode: 409,
            });
        }
        return rows[0] ? mapTemplate(rows[0]) : null;
      } catch (error) {
        rethrowChecklistTemplateWriteError(error);
      }
    },

    async previewCaseMigration(id, cursor, limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Template preview limit must be1–100.");
      const [template] = await sql<TemplateRow[]>`select * from checklist_templates where id=${id}`;
      if (!template) throw new Error("Checklist template not found.");
      const rows = await sql<
        {
          id: string;
          company_name: string;
          return_year: number;
          checklist_template_revision: number;
          closed: boolean;
          labels: string[];
        }[]
      >`
        select arc.id,c.company_name,arc.return_year,arc.checklist_template_revision,
          (arc.current_status in ('Filed','Completed') or arc.locked_at is not null) closed,
          array(select i.item_label from annual_return_checklist_items i where i.case_id=arc.id order by i.id) labels
        from annual_return_cases arc join companies c on c.id=arc.company_id
        where arc.checklist_template_source_id=${id} and (${cursor ?? null}::uuid is null or arc.id>${cursor ?? null}::uuid)
        order by arc.id limit ${limit + 1}`;
      const [counts] = await sql<
        { total: number; unknown: number }[]
      >`select count(*) filter(where checklist_template_source_id=${id})::int total,count(*) filter(where checklist_template_source_id is null)::int unknown from annual_return_cases`;
      const proposed = template.documents.map((x) => x.label);
      return {
        revision: template.revision,
        total: counts.total,
        unknownLegacyCases: counts.unknown,
        cases: rows.slice(0, limit).map((row) => ({
          caseId: row.id,
          companyName: row.company_name,
          returnYear: row.return_year,
          fromRevision: row.checklist_template_revision,
          toRevision: template.revision,
          added: proposed.filter((label) => !row.labels.includes(label)),
          removed: row.labels.filter((label) => !proposed.includes(label)),
          closed: row.closed,
        })),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },

    async duplicateTemplate(id) {
      const source = await sql<TemplateRow[]>`select * from checklist_templates where id = ${id}`;
      const template = source[0];
      if (!template) return null;

      const freshen = <T extends { id: string }>(items: T[]) =>
        items.map((item) => ({ ...item, id: crypto.randomUUID() }));

      try {
        const rows = await sql<TemplateRow[]>`
          insert into checklist_templates (name, service_type, description, active, documents, reminders, risk_rules)
          values (
            ${`${template.name} (copy)`},
            ${template.service_type},
            ${template.description},
            ${template.active},
            ${sql.json(freshen(template.documents))},
            ${sql.json(freshen(template.reminders))},
            ${sql.json(freshen(template.risk_rules))}
          )
          returning *
        `;
        return mapTemplate(rows[0]!);
      } catch (error) {
        rethrowChecklistTemplateWriteError(error);
      }
    },

    async deleteTemplate(id) {
      await sql`delete from checklist_templates where id = ${id}`;
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
