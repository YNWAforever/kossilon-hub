import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import { rethrowClientWriteError } from "./errors";
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

  async function assertActor(tx: TransactionSqlClient, actorId: string): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      select id from users where id = ${actorId} and active limit 1
    `;

    if (rows.length === 0) {
      throw new Error("Client actor not found or inactive.");
    }
  }

  async function writeTimelineEvent(
    tx: TransactionSqlClient,
    input: { companyId: string; eventType: string; actorId: string; description: string },
  ): Promise<void> {
    await tx`
      insert into timeline_events (company_id, event_type, actor_type, actor_id, description)
      values (${input.companyId}, ${input.eventType}, 'user', ${input.actorId}, ${input.description})
    `;
  }

  async function insertContact(
    tx: TransactionSqlClient,
    companyId: string,
    contact: { name: string; role: string; email: string | null; phone: string | null; isPrimary: boolean },
  ): Promise<void> {
    if (contact.isPrimary) {
      await tx`
        update company_contacts set is_primary = false, updated_at = now()
        where company_id = ${companyId} and is_primary
      `;
    }

    await tx`
      insert into company_contacts (company_id, name, role, email, phone, is_primary)
      values (
        ${companyId}, ${contact.name}, ${contact.role},
        ${contact.email}, ${contact.phone}, ${contact.isPrimary}
      )
    `;
  }

  /** Re-reads the company inside the transaction so callers get post-write state. */
  async function hydrateOrThrow(
    tx: TransactionSqlClient,
    companyId: string,
  ): Promise<ClientDetail> {
    const detail = await hydrateClient(tx, companyId);

    if (!detail) {
      throw new Error("Client not found.");
    }

    return detail;
  }

  async function createClient(input: CreateClientInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);

        const rows = await tx<{ id: string }[]>`
          insert into companies (
            company_name, cr_number, br_number, incorporation_date,
            annual_return_basis_date, registered_office, company_secretary,
            status, assigned_owner_id, assigned_team_id, service_package_id
          )
          values (
            ${input.companyName}, ${input.crNumber}, ${input.brNumber},
            ${input.incorporationDate}, ${input.annualReturnBasisDate},
            ${input.registeredOffice}, ${input.companySecretary},
            'active', ${input.ownerId}, ${input.teamId}, ${input.packageId}
          )
          returning id
        `;

        const companyId = rows[0].id;

        for (const contact of input.contacts) {
          await insertContact(tx, companyId, contact);
        }

        await writeTimelineEvent(tx, {
          companyId,
          eventType: "client_created",
          actorId: input.actorId,
          description: `Client ${input.companyName} added to the register.`,
        });

        return hydrateOrThrow(tx, companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  /** Field names whose values changed, for the timeline entry. */
  function changedFields(
    before: ClientDetail,
    input: UpdateClientInput,
  ): string[] {
    const comparisons: [string, unknown, unknown][] = [
      ["companyName", before.companyName, input.companyName],
      ["registeredOffice", before.registeredOffice, input.registeredOffice],
      ["companySecretary", before.companySecretary, input.companySecretary],
      ["status", before.status, input.status],
      ["ownerId", before.ownerId, input.ownerId],
      ["teamId", before.teamId, input.teamId],
      ["packageId", before.packageId, input.packageId],
    ];

    return comparisons
      .filter(([, previous, next]) => previous !== next)
      .map(([field]) => field);
  }

  async function updateClient(input: UpdateClientInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);

        const before = await hydrateOrThrow(tx, input.id);
        const changed = changedFields(before, input);

        await tx`
          update companies
          set company_name = ${input.companyName},
              registered_office = ${input.registeredOffice},
              company_secretary = ${input.companySecretary},
              status = ${input.status},
              assigned_owner_id = ${input.ownerId},
              assigned_team_id = ${input.teamId},
              service_package_id = ${input.packageId},
              updated_at = now()
          where id = ${input.id}
        `;

        if (changed.length > 0) {
          await writeTimelineEvent(tx, {
            companyId: input.id,
            eventType: "client_updated",
            actorId: input.actorId,
            description: `Updated ${changed.join(", ")}.`,
          });
        }

        return hydrateOrThrow(tx, input.id);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function assertContactBelongsToCompany(
    tx: TransactionSqlClient,
    companyId: string,
    contactId: string,
  ): Promise<ContactRow> {
    const rows = await tx<ContactRow[]>`
      select id, company_id, name, role, email, phone, is_primary
      from company_contacts
      where id = ${contactId} and company_id = ${companyId}
      limit 1
    `;

    const [row] = rows;

    if (!row) {
      throw new Error("Contact not found for this company.");
    }

    return row;
  }

  async function addContact(input: AddContactInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        await hydrateOrThrow(tx, input.companyId);

        await insertContact(tx, input.companyId, {
          name: input.name,
          role: input.role,
          email: input.email,
          phone: input.phone,
          isPrimary: input.isPrimary,
        });

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "contact_added",
          actorId: input.actorId,
          description: `Added contact ${input.name} (${input.role}).`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function updateContact(input: UpdateContactInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        await assertContactBelongsToCompany(tx, input.companyId, input.contactId);

        if (input.isPrimary) {
          await tx`
            update company_contacts set is_primary = false, updated_at = now()
            where company_id = ${input.companyId}
              and is_primary
              and id <> ${input.contactId}
          `;
        }

        await tx`
          update company_contacts
          set name = ${input.name},
              role = ${input.role},
              email = ${input.email},
              phone = ${input.phone},
              is_primary = ${input.isPrimary},
              updated_at = now()
          where id = ${input.contactId} and company_id = ${input.companyId}
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "contact_updated",
          actorId: input.actorId,
          description: `Updated contact ${input.name} (${input.role}).`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function removeContact(input: RemoveContactInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        const contact = await assertContactBelongsToCompany(
          tx,
          input.companyId,
          input.contactId,
        );

        await tx`
          delete from company_contacts
          where id = ${input.contactId} and company_id = ${input.companyId}
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "contact_removed",
          actorId: input.actorId,
          description: `Removed contact ${contact.name} (${contact.role}).`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
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
    createClient,
    updateClient,
    addContact,
    updateContact,
    removeContact,
    close,
  };
}
