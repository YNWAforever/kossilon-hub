import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type {
  AddContactInput,
  ClientAnnualReturnEntry,
  ClientAssignmentOptions,
  ClientDetail,
  ClientDocument,
  ClientPaymentStatus,
  ClientSummary,
  ClientTimelineEntry,
  CompanyContact,
  CompanyStatus,
  CreateClientInput,
  RemoveContactInput,
  ServicePackage,
  UpdateClientInput,
  UpdateContactInput,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type TransactionSqlClient = postgres.TransactionSql;

export type CreateClientRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export type ClientRepository = {
  listServicePackages(): Promise<ServicePackage[]>;
  listAssignmentOptions(): Promise<ClientAssignmentOptions>;
  listClients(): Promise<ClientSummary[]>;
  getClient(id: string): Promise<ClientDetail | null>;
  createClient(input: CreateClientInput): Promise<ClientDetail>;
  updateClient(input: UpdateClientInput): Promise<ClientDetail>;
  addContact(input: AddContactInput): Promise<ClientDetail>;
  updateContact(input: UpdateContactInput): Promise<ClientDetail>;
  removeContact(input: RemoveContactInput): Promise<ClientDetail>;
  close(): Promise<void>;
};

type SummaryRow = {
  id: string;
  company_name: string;
  cr_number: string;
  br_number: string;
  status: CompanyStatus;
  service_package_id: string | null;
  package_name: string | null;
  owner_id: string;
  owner_name: string;
  team_id: string;
  team_name: string;
  filing_due_date: string | Date | null;
  payment_status: ClientPaymentStatus | null;
  payment_amount: number | null;
};

type DetailRow = SummaryRow & {
  incorporation_date: string | Date;
  annual_return_basis_date: string | Date;
  registered_office: string;
  company_secretary: string;
};

type ContactRow = {
  id: string;
  company_id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
};

type PackageRow = {
  id: string;
  name: string;
  default_fee: number;
  currency: "HKD";
  active: boolean;
  sort_order: number;
};

function dateOnly(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

function timestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** "Amy Chan" -> "AC". Single-word names fall back to their first two letters. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "??";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function mapPackage(row: PackageRow): ServicePackage {
  return {
    id: row.id,
    name: row.name,
    defaultFee: row.default_fee,
    currency: row.currency,
    active: row.active,
    sortOrder: row.sort_order,
  };
}

function mapContact(row: ContactRow): CompanyContact {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    isPrimary: row.is_primary,
  };
}

function mapSummary(row: SummaryRow): ClientSummary {
  return {
    id: row.id,
    companyName: row.company_name,
    crNumber: row.cr_number,
    brNumber: row.br_number,
    status: row.status,
    packageId: row.service_package_id,
    packageName: row.package_name,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerInitials: initialsFor(row.owner_name),
    teamId: row.team_id,
    teamName: row.team_name,
    arDueDate: row.filing_due_date ? dateOnly(row.filing_due_date) : null,
    paymentStatus: row.payment_status,
    invoiceAmount: row.payment_amount,
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

export function createClientRepository(
  options?: CreateClientRepositoryOptions,
): ClientRepository;
export function createClientRepository(
  databaseUrl: string | undefined,
  options?: CreateClientRepositoryOptions,
): ClientRepository;
export function createClientRepository(
  databaseUrlOrOptions?: string | CreateClientRepositoryOptions,
  maybeOptions?: CreateClientRepositoryOptions,
): ClientRepository {
  const hasDatabaseUrlArgument =
    typeof databaseUrlOrOptions === "string" || maybeOptions !== undefined;
  const options = hasDatabaseUrlArgument ? (maybeOptions ?? {}) : (databaseUrlOrOptions ?? {});
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  async function listServicePackages(): Promise<ServicePackage[]> {
    const rows = await sql<PackageRow[]>`
      select id, name, default_fee, currency, active, sort_order
      from service_packages
      order by sort_order asc, name asc
    `;

    return rows.map(mapPackage);
  }

  async function listAssignmentOptions(): Promise<ClientAssignmentOptions> {
    const [owners, teams, packages] = await Promise.all([
      sql<{ id: string; name: string; team_id: string | null }[]>`
        select id, name, team_id
        from users
        where active
        order by name asc
      `,
      sql<{ id: string; name: string }[]>`
        select id, name
        from teams
        where active
        order by name asc
      `,
      listServicePackages(),
    ]);

    return {
      owners: owners.map((owner) => ({
        id: owner.id,
        name: owner.name,
        teamId: owner.team_id,
      })),
      teams: teams.map((team) => ({ id: team.id, name: team.name })),
      packages,
    };
  }

  async function listClients(): Promise<ClientSummary[]> {
    const rows = await sql<SummaryRow[]>`
      select
        c.id,
        c.company_name,
        c.cr_number,
        c.br_number,
        c.status,
        c.service_package_id,
        sp.name as package_name,
        u.id as owner_id,
        u.name as owner_name,
        t.id as team_id,
        t.name as team_name,
        latest.filing_due_date,
        latest.payment_status,
        latest.payment_amount
      from companies c
      join users u on u.id = c.assigned_owner_id
      join teams t on t.id = c.assigned_team_id
      left join service_packages sp on sp.id = c.service_package_id
      left join lateral (
        select
          arc.filing_due_date,
          p.status as payment_status,
          p.amount as payment_amount
        from annual_return_cases arc
        left join payments p on p.case_id = arc.id
        where arc.company_id = c.id
        order by arc.return_year desc, arc.filing_due_date desc
        limit 1
      ) latest on true
      order by c.company_name asc
    `;

    return rows.map(mapSummary);
  }

  async function hydrateClient(
    client: QueryClient,
    id: string,
  ): Promise<ClientDetail | null> {
    const detailRows = await client<DetailRow[]>`
      select
        c.id,
        c.company_name,
        c.cr_number,
        c.br_number,
        c.status,
        c.incorporation_date,
        c.annual_return_basis_date,
        c.registered_office,
        c.company_secretary,
        c.service_package_id,
        sp.name as package_name,
        u.id as owner_id,
        u.name as owner_name,
        t.id as team_id,
        t.name as team_name,
        latest.filing_due_date,
        latest.payment_status,
        latest.payment_amount
      from companies c
      join users u on u.id = c.assigned_owner_id
      join teams t on t.id = c.assigned_team_id
      left join service_packages sp on sp.id = c.service_package_id
      left join lateral (
        select
          arc.filing_due_date,
          p.status as payment_status,
          p.amount as payment_amount
        from annual_return_cases arc
        left join payments p on p.case_id = arc.id
        where arc.company_id = c.id
        order by arc.return_year desc, arc.filing_due_date desc
        limit 1
      ) latest on true
      where c.id = ${id}
      limit 1
    `;

    const [detailRow] = detailRows;

    if (!detailRow) {
      return null;
    }

    const [contacts, timeline, history, documents] = await Promise.all([
      client<ContactRow[]>`
        select id, company_id, name, role, email, phone, is_primary
        from company_contacts
        where company_id = ${id}
        order by is_primary desc, name asc
      `,
      client<
        {
          id: string;
          event_type: string;
          actor_type: "system" | "user";
          actor_name: string | null;
          description: string;
          created_at: string | Date;
        }[]
      >`
        select te.id, te.event_type, te.actor_type, u.name as actor_name,
               te.description, te.created_at
        from timeline_events te
        left join users u on u.id = te.actor_id
        where te.company_id = ${id}
        order by te.created_at desc
        limit 50
      `,
      client<
        {
          id: string;
          return_year: number;
          made_up_date: string | Date;
          filing_due_date: string | Date;
          current_status: string;
        }[]
      >`
        select id, return_year, made_up_date, filing_due_date, current_status
        from annual_return_cases
        where company_id = ${id}
        order by return_year desc
      `,
      client<
        {
          id: string;
          file_name: string;
          file_type: string;
          verification_status: ClientDocument["verificationStatus"];
          uploaded_at: string | Date;
        }[]
      >`
        select id, file_name, file_type, verification_status, uploaded_at
        from documents
        where company_id = ${id}
        order by uploaded_at desc
      `,
    ]);

    return {
      ...mapSummary(detailRow),
      incorporationDate: dateOnly(detailRow.incorporation_date),
      annualReturnBasisDate: dateOnly(detailRow.annual_return_basis_date),
      registeredOffice: detailRow.registered_office,
      companySecretary: detailRow.company_secretary,
      contacts: contacts.map(mapContact),
      timeline: timeline.map(
        (row): ClientTimelineEntry => ({
          id: row.id,
          eventType: row.event_type,
          actorType: row.actor_type,
          actorName: row.actor_name,
          description: row.description,
          createdAt: timestampString(row.created_at),
        }),
      ),
      annualReturnHistory: history.map(
        (row): ClientAnnualReturnEntry => ({
          id: row.id,
          returnYear: row.return_year,
          madeUpDate: dateOnly(row.made_up_date),
          filingDueDate: dateOnly(row.filing_due_date),
          currentStatus: row.current_status,
        }),
      ),
      documents: documents.map(
        (row): ClientDocument => ({
          id: row.id,
          fileName: row.file_name,
          fileType: row.file_type,
          verificationStatus: row.verification_status,
          uploadedAt: timestampString(row.uploaded_at),
        }),
      ),
    };
  }

  async function getClient(id: string): Promise<ClientDetail | null> {
    return hydrateClient(sql, id);
  }

  async function close(): Promise<void> {
    if (ownsClient && "end" in sql) {
      await sql.end();
    }
  }

  return {
    listServicePackages,
    listAssignmentOptions,
    listClients,
    getClient,
    createClient: async () => {
      throw new Error("createClient is implemented in Task 6.");
    },
    updateClient: async () => {
      throw new Error("updateClient is implemented in Task 6.");
    },
    addContact: async () => {
      throw new Error("addContact is implemented in Task 7.");
    },
    updateContact: async () => {
      throw new Error("updateContact is implemented in Task 7.");
    },
    removeContact: async () => {
      throw new Error("removeContact is implemented in Task 7.");
    },
    close,
  };
}
