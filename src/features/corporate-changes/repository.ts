import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import { rethrowClientWriteError } from "@/features/clients/errors";
import { ensureWorkItemForEvent } from "@/features/work-items/repository";
import { checklistLabelsFor, isAllowedCorporateChangeStatusTransition } from "./workflow";
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

type TransactionSqlClient = postgres.TransactionSql;

function withTransaction<T>(
  client: QueryClient,
  handler: (tx: TransactionSqlClient) => Promise<T>,
): Promise<T> {
  if ("begin" in client) {
    return client.begin(handler) as Promise<T>;
  }

  return handler(client);
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

type RequestSummaryRow = Pick<
  RequestRow,
  "id" | "company_id" | "change_type" | "status" | "owner_id" | "quoted_fee" | "created_at"
> & { company_name: string };

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
    const rows = await sql<RequestSummaryRow[]>`
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

  async function createRequest(
    input: CreateCorporateChangeRequestInput,
  ): Promise<CorporateChangeRequestDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        const companyRows = await tx<{ id: string; assigned_team_id: string }[]>`
          select id, assigned_team_id from companies where id = ${input.companyId} for update
        `;
        const company = companyRows[0];
        if (!company) throw new Error("Company not found.");

        let insertedId: string;

        if (input.changeType === "name_change") {
          const rows = await tx<{ id: string }[]>`
            insert into corporate_change_requests (
              company_id, change_type, owner_id, quoted_fee, new_name_en, new_name_zh
            ) values (
              ${input.companyId}, 'name_change', ${input.actorId}, ${input.quotedFee},
              ${input.newNameEn}, ${input.newNameZh}
            ) returning id
          `;
          insertedId = rows[0].id;
        } else if (input.changeType === "share_transfer") {
          const rows = await tx<{ id: string }[]>`
            insert into corporate_change_requests (
              company_id, change_type, owner_id, quoted_fee,
              transferor_shareholding_id, transferee_shareholding_id,
              transferee_new_shareholder_name, transferee_new_shareholder_address,
              shares_transferred, consideration, stamp_duty_amount
            ) values (
              ${input.companyId}, 'share_transfer', ${input.actorId}, ${input.quotedFee},
              ${input.transferorShareholdingId}, ${input.transfereeShareholdingId},
              ${input.transfereeNewShareholderName}, ${input.transfereeNewShareholderAddress},
              ${input.sharesTransferred}, ${input.consideration}, ${input.stampDutyAmount}
            ) returning id
          `;
          insertedId = rows[0].id;
        } else if (input.changeType === "officer_change") {
          const rows = await tx<{ id: string }[]>`
            insert into corporate_change_requests (
              company_id, change_type, owner_id, quoted_fee,
              officer_id, officer_action, new_officer_type, new_officer_name,
              new_officer_identification_type, new_officer_identification_number,
              new_officer_address, effective_date
            ) values (
              ${input.companyId}, 'officer_change', ${input.actorId}, ${input.quotedFee},
              ${input.officerId}, ${input.officerAction}, ${input.newOfficerType}, ${input.newOfficerName},
              ${input.newOfficerIdentificationType}, ${input.newOfficerIdentificationNumber},
              ${input.newOfficerAddress}, ${input.effectiveDate}
            ) returning id
          `;
          insertedId = rows[0].id;
        } else {
          const rows = await tx<{ id: string }[]>`
            insert into corporate_change_requests (
              company_id, change_type, owner_id, quoted_fee, new_registered_office
            ) values (
              ${input.companyId}, 'address_change', ${input.actorId}, ${input.quotedFee},
              ${input.newRegisteredOffice}
            ) returning id
          `;
          insertedId = rows[0].id;
        }

        for (const label of checklistLabelsFor(input.changeType)) {
          await tx`
            insert into corporate_change_checklist_items (request_id, item_label)
            values (${insertedId}, ${label})
          `;
        }

        await ensureWorkItemForEvent(tx, {
          companyId: input.companyId,
          caseType: "corporate_change_request",
          corporateChangeRequestId: insertedId,
          sourceEventKey: `corporate-change:${insertedId}:created`,
          sourceEventType: "corporate_change_request_created",
          workType: "corporate_change_request",
          title: `Process ${input.changeType.replace("_", " ")} request`,
          ownerId: input.actorId,
          teamId: company.assigned_team_id,
        });

        return hydrateOrThrow(tx, insertedId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function updateChecklistItemStatus(
    input: UpdateChecklistItemStatusInput,
  ): Promise<CorporateChangeRequestDetail> {
    return withTransaction(sql, async (tx) => {
      await tx`
        update corporate_change_checklist_items
        set status = ${input.status},
            note = ${input.note},
            received_at = case when ${input.status} = 'Received' then now() else received_at end,
            verified_at = case when ${input.status} = 'Verified' then now() else verified_at end,
            updated_at = now()
        where id = ${input.itemId} and request_id = ${input.requestId}
      `;
      return hydrateOrThrow(tx, input.requestId);
    });
  }

  async function transitionStatus(
    input: TransitionStatusInput,
  ): Promise<CorporateChangeRequestDetail> {
    return withTransaction(sql, async (tx) => {
      const rows = await tx<{ status: CorporateChangeRequest["status"] }[]>`
        select status from corporate_change_requests where id = ${input.requestId} for update
      `;
      const current = rows[0];
      if (!current) throw new Error("Corporate change request not found.");
      if (!isAllowedCorporateChangeStatusTransition(current.status, input.toStatus)) {
        throw new Error(`Cannot transition from ${current.status} to ${input.toStatus}.`);
      }

      await tx`
        update corporate_change_requests set status = ${input.toStatus}, updated_at = now()
        where id = ${input.requestId}
      `;

      return hydrateOrThrow(tx, input.requestId);
    });
  }

  async function cancelRequest(input: CancelRequestInput): Promise<CorporateChangeRequestDetail> {
    return withTransaction(sql, async (tx) => {
      const rows = await tx<{ status: CorporateChangeRequest["status"] }[]>`
        select status from corporate_change_requests where id = ${input.requestId} for update
      `;
      const current = rows[0];
      if (!current) throw new Error("Corporate change request not found.");
      if (!isAllowedCorporateChangeStatusTransition(current.status, "Cancelled")) {
        throw new Error(`Cannot transition from ${current.status} to Cancelled.`);
      }

      await tx`
        update corporate_change_requests set status = 'Cancelled', updated_at = now()
        where id = ${input.requestId}
      `;
      await tx`
        update work_items set status = 'cancelled', updated_at = now()
        where corporate_change_request_id = ${input.requestId}
      `;

      return hydrateOrThrow(tx, input.requestId);
    });
  }

  return {
    listRequests,
    getRequest,
    getCompanyTeamId,
    createRequest,
    updateChecklistItemStatus,
    transitionStatus,
    cancelRequest,
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
