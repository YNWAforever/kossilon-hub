import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import { isAllowedIntakeStatusTransition, oneYearLater } from "./workflow";
import type {
  ChecklistItemStatus,
  CompleteIncorporationCaseInput,
  CreateIncorporationCaseInput,
  IncorporationCase,
  IncorporationCaseSummary,
  IncorporationChecklistItem,
  IncorporationStatus,
  UpdateIncorporationCaseStatusInput,
  UpdateIncorporationChecklistItemInput,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type TransactionSqlClient = postgres.TransactionSql;

export type CreateIncorporationRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export type IncorporationRepository = {
  listCases(): Promise<IncorporationCaseSummary[]>;
  getCase(id: string): Promise<IncorporationCase | null>;
  getCaseTeamId(caseId: string): Promise<string | null>;
  createCase(input: CreateIncorporationCaseInput): Promise<IncorporationCase>;
  updateChecklistItem(input: UpdateIncorporationChecklistItemInput): Promise<IncorporationCase>;
  updateCaseStatus(input: UpdateIncorporationCaseStatusInput): Promise<IncorporationCase>;
  completeCase(input: CompleteIncorporationCaseInput): Promise<IncorporationCase>;
  close(): Promise<void>;
};

type CaseRow = {
  id: string;
  proposed_company_name_en: string;
  proposed_company_name_zh: string | null;
  proposed_registered_office: string;
  proposed_company_secretary: string;
  registered_capital: number;
  business_nature: string;
  status: IncorporationStatus;
  owner_id: string;
  owner_name: string;
  team_id: string;
  team_name: string;
  target_completion_date: string | Date;
  company_id: string | null;
  completed_at: string | Date | null;
  created_at: string | Date;
};

type ChecklistItemRow = {
  id: string;
  case_id: string;
  item_label: string;
  required: boolean;
  status: ChecklistItemStatus;
  note: string | null;
  received_at: string | Date | null;
  verified_at: string | Date | null;
};

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function timestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapChecklistItem(row: ChecklistItemRow): IncorporationChecklistItem {
  return {
    id: row.id,
    caseId: row.case_id,
    itemLabel: row.item_label,
    required: row.required,
    status: row.status,
    note: row.note,
    receivedAt: row.received_at ? timestampString(row.received_at) : null,
    verifiedAt: row.verified_at ? timestampString(row.verified_at) : null,
  };
}

function mapCaseSummary(row: CaseRow): IncorporationCaseSummary {
  return {
    id: row.id,
    proposedCompanyNameEn: row.proposed_company_name_en,
    proposedCompanyNameZh: row.proposed_company_name_zh,
    proposedRegisteredOffice: row.proposed_registered_office,
    proposedCompanySecretary: row.proposed_company_secretary,
    registeredCapital: row.registered_capital,
    businessNature: row.business_nature,
    status: row.status,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    teamId: row.team_id,
    teamName: row.team_name,
    targetCompletionDate: dateOnly(row.target_completion_date),
    companyId: row.company_id,
    completedAt: row.completed_at ? timestampString(row.completed_at) : null,
    createdAt: timestampString(row.created_at),
  };
}

function withTransaction<T>(
  client: QueryClient,
  handler: (tx: TransactionSqlClient) => Promise<T>,
): Promise<T> {
  if ("begin" in client) {
    return client.begin(handler) as Promise<T>;
  }

  return handler(client as TransactionSqlClient);
}

export function createIncorporationRepository(
  options?: CreateIncorporationRepositoryOptions,
): IncorporationRepository;
export function createIncorporationRepository(
  databaseUrl: string | undefined,
  options?: CreateIncorporationRepositoryOptions,
): IncorporationRepository;
export function createIncorporationRepository(
  databaseUrlOrOptions?: string | CreateIncorporationRepositoryOptions,
  maybeOptions?: CreateIncorporationRepositoryOptions,
): IncorporationRepository {
  const hasDatabaseUrlArgument =
    typeof databaseUrlOrOptions === "string" || maybeOptions !== undefined;
  const options = hasDatabaseUrlArgument ? (maybeOptions ?? {}) : (databaseUrlOrOptions ?? {});
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  async function listCases(): Promise<IncorporationCaseSummary[]> {
    const rows = await sql<CaseRow[]>`
      select
        ic.id, ic.proposed_company_name_en, ic.proposed_company_name_zh,
        ic.proposed_registered_office, ic.proposed_company_secretary, ic.registered_capital,
        ic.business_nature, ic.status, u.id as owner_id, u.name as owner_name,
        t.id as team_id, t.name as team_name, ic.target_completion_date, ic.company_id,
        ic.completed_at, ic.created_at
      from incorporation_cases ic
      join users u on u.id = ic.owner_id
      join teams t on t.id = ic.team_id
      order by ic.created_at desc
    `;
    return rows.map(mapCaseSummary);
  }

  async function hydrateCase(client: QueryClient, id: string): Promise<IncorporationCase | null> {
    const caseRows = await client<CaseRow[]>`
      select
        ic.id, ic.proposed_company_name_en, ic.proposed_company_name_zh,
        ic.proposed_registered_office, ic.proposed_company_secretary, ic.registered_capital,
        ic.business_nature, ic.status, u.id as owner_id, u.name as owner_name,
        t.id as team_id, t.name as team_name, ic.target_completion_date, ic.company_id,
        ic.completed_at, ic.created_at
      from incorporation_cases ic
      join users u on u.id = ic.owner_id
      join teams t on t.id = ic.team_id
      where ic.id = ${id}
      limit 1
    `;

    const [caseRow] = caseRows;
    if (!caseRow) return null;

    const checklist = await client<ChecklistItemRow[]>`
      select id, case_id, item_label, required, status, note, received_at, verified_at
      from incorporation_checklist_items
      where case_id = ${id}
      order by created_at asc
    `;

    return {
      ...mapCaseSummary(caseRow),
      checklist: checklist.map(mapChecklistItem),
    };
  }

  async function getCase(id: string): Promise<IncorporationCase | null> {
    return hydrateCase(sql, id);
  }

  async function getCaseTeamId(caseId: string): Promise<string | null> {
    const rows = await sql<{ team_id: string }[]>`
      select team_id from incorporation_cases where id = ${caseId} limit 1
    `;
    return rows[0]?.team_id ?? null;
  }

  async function hydrateOrThrow(
    tx: TransactionSqlClient,
    caseId: string,
  ): Promise<IncorporationCase> {
    const result = await hydrateCase(tx, caseId);
    if (!result) throw new Error("Incorporation case not found.");
    return result;
  }

  async function assertActor(tx: TransactionSqlClient, actorId: string): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      select id from users where id = ${actorId} and active limit 1
    `;
    if (rows.length === 0) throw new Error("Incorporation actor not found or inactive.");
  }

  async function createCase(input: CreateIncorporationCaseInput): Promise<IncorporationCase> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);

      const ownerRows = await tx<{ id: string }[]>`
        select id from users where id = ${input.ownerId} and active limit 1
      `;
      if (ownerRows.length !== 1) throw new Error("Incorporation owner not found or inactive.");

      const templateRows = await tx<{ documents: { label: string; required: boolean }[] }[]>`
        select documents from checklist_templates
        where service_type = 'Incorporation — HK Ltd' and active limit 1
      `;
      const template = templateRows[0];
      if (!template) throw new Error("No active incorporation checklist template exists.");

      const caseRows = await tx<{ id: string }[]>`
        insert into incorporation_cases (
          proposed_company_name_en, proposed_company_name_zh, proposed_registered_office,
          proposed_company_secretary, registered_capital, business_nature,
          owner_id, team_id, target_completion_date
        ) values (
          ${input.proposedCompanyNameEn}, ${input.proposedCompanyNameZh},
          ${input.proposedRegisteredOffice}, ${input.proposedCompanySecretary},
          ${input.registeredCapital}, ${input.businessNature},
          ${input.ownerId}, ${input.teamId}, ${input.targetCompletionDate}
        )
        returning id
      `;
      const newCaseId = caseRows[0].id;

      for (const document of template.documents) {
        await tx`
          insert into incorporation_checklist_items (case_id, item_label, required)
          values (${newCaseId}, ${document.label}, ${document.required})
        `;
      }

      return hydrateOrThrow(tx, newCaseId);
    });
  }

  async function assertItemBelongsToCase(
    tx: TransactionSqlClient,
    caseId: string,
    itemId: string,
  ): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      select id from incorporation_checklist_items where id = ${itemId} and case_id = ${caseId} limit 1
    `;
    if (rows.length === 0) throw new Error("Checklist item not found for this case.");
  }

  async function updateChecklistItem(
    input: UpdateIncorporationChecklistItemInput,
  ): Promise<IncorporationCase> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);
      await assertItemBelongsToCase(tx, input.caseId, input.itemId);

      const hasReceived = input.status === "Received" || input.status === "Verified";
      const hasVerified = input.status === "Verified";

      await tx`
        update incorporation_checklist_items
        set status = ${input.status}, note = ${input.note},
            received_at = case when ${hasReceived} then coalesce(received_at, now()) else null end,
            verified_at = case when ${hasVerified} then coalesce(verified_at, now()) else null end,
            updated_at = now()
        where id = ${input.itemId} and case_id = ${input.caseId}
      `;

      return hydrateOrThrow(tx, input.caseId);
    });
  }

  async function updateCaseStatus(
    input: UpdateIncorporationCaseStatusInput,
  ): Promise<IncorporationCase> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);

      const current = await hydrateOrThrow(tx, input.caseId);
      if (!isAllowedIntakeStatusTransition(current.status, input.status)) {
        throw new Error(`Cannot move a case from ${current.status} to ${input.status}.`);
      }

      await tx`
        update incorporation_cases set status = ${input.status}, updated_at = now()
        where id = ${input.caseId}
      `;

      return hydrateOrThrow(tx, input.caseId);
    });
  }

  async function completeCase(input: CompleteIncorporationCaseInput): Promise<IncorporationCase> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);
      await tx`select id from incorporation_cases where id = ${input.caseId} for update`;

      const current = await hydrateOrThrow(tx, input.caseId);
      if (current.status !== "Filed with Registrar") {
        throw new Error(
          `Cannot complete a case from status ${current.status}; it must be Filed with Registrar.`,
        );
      }

      const annualReturnBasisDate = oneYearLater(input.incorporationDate);

      const companyRows = await tx<{ id: string }[]>`
        insert into companies (
          company_name, cr_number, br_number, incorporation_date,
          annual_return_basis_date, registered_office, company_secretary,
          status, assigned_owner_id, assigned_team_id
        )
        values (
          ${current.proposedCompanyNameEn}, ${input.crNumber}, ${input.brNumber},
          ${input.incorporationDate}, ${annualReturnBasisDate},
          ${current.proposedRegisteredOffice}, ${current.proposedCompanySecretary},
          'active', ${current.ownerId}, ${current.teamId}
        )
        returning id
      `;
      const companyId = companyRows[0].id;

      await tx`
        insert into officers (company_id, officer_type, name, appointment_date)
        values (${companyId}, 'secretary', ${current.proposedCompanySecretary}, ${input.incorporationDate})
      `;

      await tx`
        update incorporation_cases
        set status = 'Completed', company_id = ${companyId}, completed_at = now(), updated_at = now()
        where id = ${input.caseId}
      `;

      return hydrateOrThrow(tx, input.caseId);
    });
  }

  async function close(): Promise<void> {
    if (ownsClient && "end" in sql) await sql.end();
  }

  return {
    listCases,
    getCase,
    getCaseTeamId,
    createCase,
    updateChecklistItem,
    updateCaseStatus,
    completeCase,
    close,
  };
}
