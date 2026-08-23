import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type {
  CancelRequestInput,
  CompleteRequestInput,
  CorporateChangeChecklistItem,
  CorporateChangeRequest,
  CorporateChangeRequestDetail,
  CorporateChangeRequestSummary,
  CorporateChangeType,
  CreateCorporateChangeRequestInput,
  ListCorporateChangeRequestsFilter,
  TransitionStatusInput,
  UpdateChecklistItemStatusInput,
} from "./types";

// `QueryClient` is not exported from `@/server/db/client` — every sibling repository
// (clients/repository.ts, work-items/repository.ts) defines this union locally instead
// of importing it. Follow that established convention here.
type QueryClient = SqlClient | postgres.TransactionSql;

type TransactionSqlClient = QueryClient & { begin?: never };

function withTransaction<T>(
  client: QueryClient,
  handler: (tx: TransactionSqlClient) => Promise<T>,
): Promise<T> {
  if ("begin" in client) {
    return (
      client as { begin: (fn: (tx: TransactionSqlClient) => Promise<T>) => Promise<T> }
    ).begin(handler);
  }
  return handler(client as TransactionSqlClient);
}

type RequestRow = {
  id: string;
  company_id: string;
  change_type: CorporateChangeType;
  status: CorporateChangeRequest["status"];
  owner_id: string;
  quoted_fee: string;
  current_name_en: string | null;
  current_name_zh: string | null;
  new_name_en: string | null;
  new_name_zh: string | null;
  transferor_shareholding_id: string | null;
  transferee_shareholding_id: string | null;
  transferee_new_shareholder_name: string | null;
  transferee_new_shareholder_address: string | null;
  shares_transferred: number | null;
  consideration: string | null;
  stamp_duty_amount: string | null;
  officer_id: string | null;
  officer_action: CorporateChangeRequest["officerAction"];
  new_officer_type: CorporateChangeRequest["newOfficerType"];
  new_officer_name: string | null;
  new_officer_identification_type: CorporateChangeRequest["newOfficerIdentificationType"];
  new_officer_identification_number: string | null;
  new_officer_address: string | null;
  effective_date: string | Date | null;
  current_registered_office: string | null;
  new_registered_office: string | null;
  completed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type ChecklistRow = {
  id: string;
  request_id: string;
  item_label: string;
  required: boolean;
  status: CorporateChangeChecklistItem["status"];
  note: string | null;
  received_at: string | Date | null;
  verified_at: string | Date | null;
};

function iso(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

function dateOnly(value: string | Date): string {
  return iso(value).slice(0, 10);
}

function mapRequest(row: RequestRow): CorporateChangeRequest {
  return {
    id: row.id,
    companyId: row.company_id,
    changeType: row.change_type,
    status: row.status,
    ownerId: row.owner_id,
    quotedFee: Number(row.quoted_fee),
    currentNameEn: row.current_name_en,
    currentNameZh: row.current_name_zh,
    newNameEn: row.new_name_en,
    newNameZh: row.new_name_zh,
    transferorShareholdingId: row.transferor_shareholding_id,
    transfereeShareholdingId: row.transferee_shareholding_id,
    transfereeNewShareholderName: row.transferee_new_shareholder_name,
    transfereeNewShareholderAddress: row.transferee_new_shareholder_address,
    sharesTransferred: row.shares_transferred,
    consideration: row.consideration === null ? null : Number(row.consideration),
    stampDutyAmount: row.stamp_duty_amount === null ? null : Number(row.stamp_duty_amount),
    officerId: row.officer_id,
    officerAction: row.officer_action,
    newOfficerType: row.new_officer_type,
    newOfficerName: row.new_officer_name,
    newOfficerIdentificationType: row.new_officer_identification_type,
    newOfficerIdentificationNumber: row.new_officer_identification_number,
    newOfficerAddress: row.new_officer_address,
    effectiveDate: row.effective_date ? dateOnly(row.effective_date) : null,
    currentRegisteredOffice: row.current_registered_office,
    newRegisteredOffice: row.new_registered_office,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapChecklistItem(row: ChecklistRow): CorporateChangeChecklistItem {
  return {
    id: row.id,
    requestId: row.request_id,
    itemLabel: row.item_label,
    required: row.required,
    status: row.status,
    note: row.note,
    receivedAt: row.received_at ? iso(row.received_at) : null,
    verifiedAt: row.verified_at ? iso(row.verified_at) : null,
  };
}

const REQUEST_COLUMNS = `
  id, company_id, change_type, status, owner_id, quoted_fee,
  current_name_en, current_name_zh, new_name_en, new_name_zh,
  transferor_shareholding_id, transferee_shareholding_id,
  transferee_new_shareholder_name, transferee_new_shareholder_address,
  shares_transferred, consideration, stamp_duty_amount,
  officer_id, officer_action, new_officer_type, new_officer_name,
  new_officer_identification_type, new_officer_identification_number, new_officer_address,
  effective_date, current_registered_office, new_registered_office,
  completed_at, created_at, updated_at
`;

export interface CorporateChangeRequestRepository {
  listRequests(filter: ListCorporateChangeRequestsFilter): Promise<CorporateChangeRequestSummary[]>;
  getRequest(requestId: string): Promise<CorporateChangeRequestDetail>;
  createRequest(input: CreateCorporateChangeRequestInput): Promise<CorporateChangeRequestDetail>;
  updateChecklistItemStatus(
    input: UpdateChecklistItemStatusInput,
  ): Promise<CorporateChangeRequestDetail>;
  transitionStatus(input: TransitionStatusInput): Promise<CorporateChangeRequestDetail>;
  cancelRequest(input: CancelRequestInput): Promise<CorporateChangeRequestDetail>;
  completeRequest(input: CompleteRequestInput): Promise<CorporateChangeRequestDetail>;
  getCompanyTeamId(companyId: string): Promise<string>;
  close(): Promise<void>;
}

export type CreateCorporateChangeRequestRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export function createCorporateChangeRequestRepository(
  databaseUrl?: string,
  options: CreateCorporateChangeRequestRepositoryOptions = {},
): CorporateChangeRequestRepository {
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  async function hydrateOrThrow(
    tx: TransactionSqlClient,
    requestId: string,
  ): Promise<CorporateChangeRequestDetail> {
    const rows = await tx<RequestRow[]>`
      select ${sql.unsafe(REQUEST_COLUMNS)} from corporate_change_requests where id = ${requestId}
    `;
    const [row] = rows;
    if (!row) throw new Error("Corporate change request not found.");

    const checklistRows = await tx<ChecklistRow[]>`
      select id, request_id, item_label, required, status, note, received_at, verified_at
      from corporate_change_checklist_items
      where request_id = ${requestId}
      order by created_at asc
    `;

    return { ...mapRequest(row), checklistItems: checklistRows.map(mapChecklistItem) };
  }

  async function listRequests(
    filter: ListCorporateChangeRequestsFilter,
  ): Promise<CorporateChangeRequestSummary[]> {
    const rows = await sql<(RequestRow & { company_name: string })[]>`
      select r.id, r.company_id, r.change_type, r.status, r.owner_id, r.quoted_fee, r.created_at,
             c.company_name
      from corporate_change_requests r
      join companies c on c.id = r.company_id
      where (${filter.changeType ?? null}::text is null or r.change_type = ${filter.changeType ?? null})
        and (${filter.status ?? null}::text is null or r.status = ${filter.status ?? null})
        and (${filter.teamId ?? null}::uuid is null or c.assigned_team_id = ${filter.teamId ?? null})
      order by r.created_at desc
    `;

    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      changeType: row.change_type,
      status: row.status,
      ownerId: row.owner_id,
      quotedFee: Number(row.quoted_fee),
      createdAt: iso(row.created_at),
      companyName: row.company_name,
    }));
  }

  async function getRequest(requestId: string): Promise<CorporateChangeRequestDetail> {
    return withTransaction(sql, (tx) => hydrateOrThrow(tx, requestId));
  }

  async function getCompanyTeamId(companyId: string): Promise<string> {
    const rows = await sql<{ assigned_team_id: string }[]>`
      select assigned_team_id from companies where id = ${companyId}
    `;
    if (!rows[0]) throw new Error("Company not found.");
    return rows[0].assigned_team_id;
  }

  // createRequest/updateChecklistItemStatus/transitionStatus/cancelRequest/completeRequest
  // are implemented in Tasks 11-15.

  return {
    listRequests,
    getRequest,
    getCompanyTeamId,
    createRequest: notImplemented("createRequest"),
    updateChecklistItemStatus: notImplemented("updateChecklistItemStatus"),
    transitionStatus: notImplemented("transitionStatus"),
    cancelRequest: notImplemented("cancelRequest"),
    completeRequest: notImplemented("completeRequest"),
    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };

  function notImplemented(name: string): () => never {
    return () => {
      throw new Error(`${name} is implemented in a later task.`);
    };
  }
}
