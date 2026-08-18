import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type postgres from "postgres";
import type {
  ChecklistTemplate,
  ChecklistTemplatePatch,
  DocumentItem,
  ReminderRule,
  RiskRule,
  ServiceType,
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
  };
}

export type ChecklistTemplateRepository = {
  listTemplates(): Promise<ChecklistTemplate[]>;
  createTemplate(serviceType: ServiceType): Promise<ChecklistTemplate>;
  updateTemplate(id: string, patch: ChecklistTemplatePatch): Promise<ChecklistTemplate | null>;
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
      const rows = await sql<TemplateRow[]>`
        insert into checklist_templates (name, service_type, description, active, documents, reminders, risk_rules)
        values ('Untitled template', ${serviceType}, '', true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
        returning *
      `;
      return mapTemplate(rows[0]!);
    },

    async updateTemplate(id, patch) {
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
          updated_at = now()
        where id = ${id}
        returning *
      `;
      return rows[0] ? mapTemplate(rows[0]) : null;
    },

    async duplicateTemplate(id) {
      const source = await sql<TemplateRow[]>`select * from checklist_templates where id = ${id}`;
      const template = source[0];
      if (!template) return null;

      const freshen = <T extends { id: string }>(items: T[]) =>
        items.map((item) => ({ ...item, id: crypto.randomUUID() }));

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
    },

    async deleteTemplate(id) {
      await sql`delete from checklist_templates where id = ${id}`;
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
