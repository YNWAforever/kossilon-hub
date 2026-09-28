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
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
function transaction<T>(
  client: QueryClient,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return "begin" in client ? (client.begin(work) as Promise<T>) : work(client);
}

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
  published_version_id: string | null;
  published_name?: string | null;
  published_service_type?: ServiceType | null;
  publication_origin?: "legacy_baseline" | "admin_publish" | null;
  archived_at: string | Date | null;
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
    publishedVersionId: row.published_version_id,
    publishedName: row.published_name,
    publishedServiceType: row.published_service_type,
    publicationOrigin: row.publication_origin,
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
  };
}

export type ChecklistTemplateRepository = {
  listTemplates(): Promise<ChecklistTemplate[]>;
  createTemplate(serviceType: ServiceType): Promise<ChecklistTemplate>;
  updateTemplate(
    id: string,
    patch: ChecklistTemplatePatch,
    expectedRevision: number,
  ): Promise<ChecklistTemplate | null>;
  publishTemplate(
    id: string,
    expectedRevision: number,
    actorId: string,
    authUserId: string,
  ): Promise<ChecklistTemplate>;
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
        select t.*,v.origin publication_origin,v.name published_name,
          v.service_type published_service_type from checklist_templates t
        left join checklist_template_versions v on v.id=t.published_version_id
        order by t.created_at asc
      `;
      return rows.map(mapTemplate);
    },

    async createTemplate(serviceType) {
      try {
        const rows = await sql<TemplateRow[]>`
          insert into checklist_templates (name, service_type, description, active, documents, reminders, risk_rules)
          values ('Untitled template', ${serviceType}, '', false, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
          returning *
        `;
        return mapTemplate(rows[0]!);
      } catch (error) {
        rethrowChecklistTemplateWriteError(error);
      }
    },

    async updateTemplate(id, patch, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
        throw new Error("A valid template revision is required.");
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
          where id = ${id} and revision = ${expectedRevision} and archived_at is null
          returning *
        `;
        if (!rows[0]) {
          const [exists] = await sql<
            { id: string }[]
          >`select id from checklist_templates where id=${id}`;
          if (exists) throw new Error("Checklist template revision changed or is archived.");
          return null;
        }
        return mapTemplate(rows[0]);
      } catch (error) {
        rethrowChecklistTemplateWriteError(error);
      }
    },

    async publishTemplate(id, expectedRevision, actorId, authUserId) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
        throw new Error("A valid template revision is required.");
      return transaction(sql, async (tx) => {
        const [currentAdmin] = await tx<{ id: string }[]>`
          select u.id from users u join staff_profiles sp on sp.user_id=u.id
          where u.id=${actorId} and sp.auth_user_id=${authUserId}
            and u.role='Admin' and sp.role='Admin' and u.active=true and sp.active=true
          for share of u,sp
        `;
        if (!currentAdmin) throw new Error("Forbidden: current Admin profile required.");
        const [draft] = await tx<TemplateRow[]>`
          select * from checklist_templates where id=${id} for update
        `;
        if (!draft || draft.archived_at) throw new Error("Editable template not found.");
        if (draft.revision !== expectedRevision)
          throw new Error("Checklist template revision changed.");
        if (new Set(draft.documents.map((document) => document.id)).size !== draft.documents.length)
          throw new Error("Template document IDs must be unique before publication.");
        if (draft.active && draft.published_version_id) {
          const [same] = await tx<{ id: string }[]>`
            select id from checklist_template_versions
            where id=${draft.published_version_id} and origin='admin_publish'
              and name=${draft.name}
              and service_type=${draft.service_type} and description=${draft.description}
              and documents=${tx.json(draft.documents)}::jsonb
              and reminders=${tx.json(draft.reminders)}::jsonb
              and risk_rules=${tx.json(draft.risk_rules)}::jsonb
          `;
          if (same) throw new Error("No unpublished template changes.");
        }
        const [next] = await tx<{ n: number }[]>`
          select coalesce(max(version_number),0)::int+1 n
          from checklist_template_versions where template_id=${id}
        `;
        const [published] = await tx<{ id: string }[]>`
          insert into checklist_template_versions
            (template_id,version_number,origin,name,service_type,description,
             documents,reminders,risk_rules,published_by)
          values (${id},${next.n},'admin_publish',${draft.name},${draft.service_type},
            ${draft.description},${tx.json(draft.documents)},${tx.json(draft.reminders)},
            ${tx.json(draft.risk_rules)},${actorId})
          returning id
        `;
        const [updated] = await tx<TemplateRow[]>`
          update checklist_templates set published_version_id=${published.id},active=true,
            revision=revision+1,updated_at=now()
          where id=${id} and revision=${expectedRevision}
          returning *
        `;
        if (!updated) throw new Error("Checklist template revision changed.");
        return mapTemplate(updated);
      });
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
            false,
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
      await sql`update checklist_templates set active=false,archived_at=now(),
        revision=revision+1,updated_at=now() where id=${id} and archived_at is null`;
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
