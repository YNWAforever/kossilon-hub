# Officers & Shareholders Register (P1-5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give companies a real officers (director/secretary) and shareholdings register with
appointment/cessation history, and make `companies.company_secretary` derive from it instead of
being independently editable — the substrate P1-6/7/9 and (eventually, separately) NAR1
generation will read from.

**Architecture:** Two new, purely-additive tables (`officers`, `shareholdings`). Extends the
existing `src/features/clients/` vertical slice — officers and shareholdings are company
sub-resources exactly like `company_contacts` already is — rather than a new feature module.
Two new dialogs mirror `ContactFormDialog`'s existing shape. Two new sections land on
`/clients/$id` between the Overview card and Contacts.

**Tech Stack:** Postgres (raw SQL via `postgres`, no ORM) · TanStack Start server fns · Zod ·
TypeScript 5.8 strict · React 19 · TanStack Query 5 · Vitest 4 + Testing Library.

**Reference files** (read, not modified beyond what's specified):
- `src/features/clients/types.ts`, `repository.ts`, `server-fns.ts`, `authorization.ts` — the
  existing client-register module this plan extends.
- `src/components/clients/contact-form-dialog.tsx` — the exact dialog shape/styling both new
  dialogs mirror.
- `src/features/clients/components/production-client-detail.tsx` — the screen both new sections
  land on.

---

### Task 1: Schema migration

**Files:**
- Create: `db/migrations/0015_officers_and_shareholdings.sql`
- Modify: `src/server/db/schema.sql` (add the two tables after `company_contacts`, around
  line 633)

- [ ] **Step 1: Write the migration**

```sql
-- 0015: officers and shareholdings registers (P1-5).
--
-- No structured director/secretary/shareholder data has existed anywhere in this
-- schema — companies.company_secretary is free text with no appointment history,
-- and grepping "director"/"shareholder" repo-wide turns up only checklist labels,
-- FAQ scripts, and demo strings. These two tables are the substrate future NAR1
-- generation (not built in this pass) and P1-6/P1-7/P1-9 will read from. Purely
-- additive — no existing column is touched.

create table if not exists officers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  officer_type text not null check (officer_type in ('director', 'secretary')),
  name text not null,
  identification_type text check (identification_type in ('hkid', 'passport', 'br_number')),
  identification_number text,
  address text,
  appointment_date date not null,
  cessation_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint officers_cessation_after_appointment check (
    cessation_date is null or cessation_date >= appointment_date
  )
);

create index if not exists officers_company_idx on officers (company_id);

create table if not exists shareholdings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  shareholder_name text not null,
  shareholder_address text,
  share_class text not null default 'Ordinary',
  number_of_shares integer not null check (number_of_shares > 0),
  allotment_date date not null,
  cessation_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shareholdings_cessation_after_allotment check (
    cessation_date is null or cessation_date >= allotment_date
  )
);

create index if not exists shareholdings_company_idx on shareholdings (company_id);
```

- [ ] **Step 2: Update the canonical schema**

In `src/server/db/schema.sql`, add the same two `create table`/`create index` blocks from
Step 1 immediately after the existing `company_contacts_company_id_idx` index (around line
633, right after `on company_contacts (company_id);`). Copy them verbatim — same table
definitions, same `if not exists` guards — since `schema.sql` is the canonical from-scratch
reference and must match what the migration produces exactly.

- [ ] **Step 3: Apply the migration to your local dev database, IF one is reachable**

Check `DATABASE_URL`. If it's set and clearly local (localhost/127.0.0.1/docker-compose
service name — NOT a real cloud/shared hostname), run `npm run db:migrate` and confirm it
completes without error. If it points to anything not obviously local, STOP and ask before
running anything. If neither `DATABASE_URL` nor `TEST_DATABASE_URL` is set at all, note that
no database is reachable here, skip applying it, and rely on the SQL syntax review — the
migration runs for real in CI/deploy per this repo's existing pipeline.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0015_officers_and_shareholdings.sql src/server/db/schema.sql
git commit -m "feat: add officers and shareholdings tables"
```

---

### Task 2: Types layer

**Files:**
- Modify: `src/features/clients/types.ts`

- [ ] **Step 1: Add the new types**

Add near the top of the file, after `CompanyContact` (around line 22):

```ts
export type OfficerType = "director" | "secretary";
export type IdentificationType = "hkid" | "passport" | "br_number";

export type Officer = {
  id: string;
  companyId: string;
  officerType: OfficerType;
  name: string;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  address: string | null;
  appointmentDate: string;
  cessationDate: string | null;
};

export type Shareholding = {
  id: string;
  companyId: string;
  shareholderName: string;
  shareholderAddress: string | null;
  shareClass: string;
  numberOfShares: number;
  allotmentDate: string;
  cessationDate: string | null;
};
```

- [ ] **Step 2: Add officers/shareholdings to `ClientDetail`**

Change:

```ts
export type ClientDetail = ClientSummary & {
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  contacts: CompanyContact[];
  timeline: ClientTimelineEntry[];
  annualReturnHistory: ClientAnnualReturnEntry[];
  documents: ClientDocument[];
};
```

to:

```ts
export type ClientDetail = ClientSummary & {
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  contacts: CompanyContact[];
  officers: Officer[];
  shareholdings: Shareholding[];
  timeline: ClientTimelineEntry[];
  annualReturnHistory: ClientAnnualReturnEntry[];
  documents: ClientDocument[];
};
```

- [ ] **Step 3: Remove `companySecretary` from `UpdateClientInput`**

`companySecretary` becomes derived from the officers table (kept in sync whenever a secretary
is appointed — see Task 3) and is no longer independently editable. `client-form-dialog.tsx`
has no rendered input for it today (confirmed by reading the file — it's tracked in form state
and submitted, but never shown to the user), so this removes dead API surface without changing
any observable behavior. Change:

```ts
export type UpdateClientInput = {
  id: string;
  companyName: string;
  registeredOffice: string;
  companySecretary: string;
  status: CompanyStatus;
  ownerId: string;
  teamId: string;
  packageId: string | null;
  actorId: string;
};
```

to:

```ts
export type UpdateClientInput = {
  id: string;
  companyName: string;
  registeredOffice: string;
  status: CompanyStatus;
  ownerId: string;
  teamId: string;
  packageId: string | null;
  actorId: string;
};
```

- [ ] **Step 4: Add the officer/shareholding input types**

Add at the end of the file, after `RemoveContactInput`:

```ts
export type AppointOfficerInput = {
  companyId: string;
  officerType: OfficerType;
  name: string;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  address: string | null;
  appointmentDate: string;
  actorId: string;
};

export type CeaseOfficerInput = {
  companyId: string;
  officerId: string;
  cessationDate: string;
  actorId: string;
};

export type RecordShareholdingInput = {
  companyId: string;
  shareholderName: string;
  shareholderAddress: string | null;
  shareClass: string;
  numberOfShares: number;
  allotmentDate: string;
  actorId: string;
};

export type CeaseShareholdingInput = {
  companyId: string;
  shareholdingId: string;
  cessationDate: string;
  actorId: string;
};
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: errors in `repository.ts` (still references the old `UpdateClientInput.companySecretary`
and doesn't yet produce `officers`/`shareholdings` on `ClientDetail`), `server-fns.ts`/
`client-form-dialog.tsx` (still reference the removed field), and — since `ClientDetail` now
requires `officers`/`shareholdings` on every value of that type — any test fixture builder
constructing a `ClientDetail` without them, e.g.
`production-client-detail.interaction.test.tsx`'s `makeClient()`. All of these persist across
Tasks 3-7 and are fully resolved only once Task 8 updates that fixture. This is expected at
every intermediate step, not a regression to chase down early.

- [ ] **Step 6: Commit**

```bash
git add src/features/clients/types.ts
git commit -m "feat: add officer/shareholding types, remove companySecretary from UpdateClientInput"
```

---

### Task 3: Repository layer — officers

**Files:**
- Modify: `src/features/clients/repository.ts`
- Modify: `src/features/clients/repository.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add a new `describe.skipIf(!databaseUrl)` block to `src/features/clients/repository.test.ts`
(check the top of the file for the existing `databaseUrl`/`createSqlClient` pattern used by
`work-items/repository.test.ts` and `annual-return/repository.test.ts` if this file doesn't
already have one — mirror that exact setup: `const databaseUrl = process.env.TEST_DATABASE_URL;`,
`sql.begin` wrapping the test body, `createClientRepository({ sql: tx })`). Add:

```ts
describe.skipIf(!databaseUrl)("officers integration", () => {
  it("appointing a new secretary cessates the old one and syncs companies.company_secretary", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createClientRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`
            select id from users where active limit 1
          `;
          const [team] = await tx<{ id: string }[]>`
            select id from teams where active limit 1
          `;

          const client = await repository.createClient({
            companyName: "Officer Test Co Ltd",
            crNumber: `CR-OFF-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-OFF-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2020-01-15",
            annualReturnBasisDate: "2020-01-15",
            registeredOffice: "1 Test Street, Hong Kong",
            companySecretary: "Original Secretary Ltd",
            ownerId: owner.id,
            teamId: team.id,
            packageId: null,
            contacts: [],
            actorId: owner.id,
          });

          // Company creation seeds an initial secretary officer.
          expect(client.officers).toHaveLength(1);
          expect(client.officers[0].officerType).toBe("secretary");
          expect(client.officers[0].name).toBe("Original Secretary Ltd");
          expect(client.officers[0].cessationDate).toBeNull();
          expect(client.companySecretary).toBe("Original Secretary Ltd");

          const updated = await repository.appointOfficer({
            companyId: client.id,
            officerType: "secretary",
            name: "New Secretary Ltd",
            identificationType: null,
            identificationNumber: null,
            address: null,
            appointmentDate: "2026-01-01",
            actorId: owner.id,
          });

          const originalSecretary = updated.officers.find((o) => o.name === "Original Secretary Ltd");
          const newSecretary = updated.officers.find((o) => o.name === "New Secretary Ltd");

          expect(originalSecretary?.cessationDate).toBe("2026-01-01");
          expect(newSecretary?.cessationDate).toBeNull();
          expect(updated.companySecretary).toBe("New Secretary Ltd");

          throw new Error("rollback officers integration fixture");
        }),
      ).rejects.toThrow("rollback officers integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("appointing a director does not affect companies.company_secretary", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createClientRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`
            select id from users where active limit 1
          `;
          const [team] = await tx<{ id: string }[]>`
            select id from teams where active limit 1
          `;

          const client = await repository.createClient({
            companyName: "Director Test Co Ltd",
            crNumber: `CR-DIR-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-DIR-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2020-01-15",
            annualReturnBasisDate: "2020-01-15",
            registeredOffice: "1 Test Street, Hong Kong",
            companySecretary: "A Secretary Ltd",
            ownerId: owner.id,
            teamId: team.id,
            packageId: null,
            contacts: [],
            actorId: owner.id,
          });

          const updated = await repository.appointOfficer({
            companyId: client.id,
            officerType: "director",
            name: "Jane Director",
            identificationType: "hkid",
            identificationNumber: "A1234567",
            address: "2 Test Street, Hong Kong",
            appointmentDate: "2026-01-01",
            actorId: owner.id,
          });

          expect(updated.companySecretary).toBe("A Secretary Ltd");
          expect(updated.officers.find((o) => o.name === "Jane Director")?.officerType).toBe(
            "director",
          );

          const ceased = await repository.ceaseOfficer({
            companyId: client.id,
            officerId: updated.officers.find((o) => o.name === "Jane Director")!.id,
            cessationDate: "2026-06-01",
            actorId: owner.id,
          });

          expect(ceased.officers.find((o) => o.name === "Jane Director")?.cessationDate).toBe(
            "2026-06-01",
          );
          expect(ceased.companySecretary).toBe("A Secretary Ltd");

          throw new Error("rollback officers integration fixture");
        }),
      ).rejects.toThrow("rollback officers integration fixture");
    } finally {
      await sql.end();
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- src/features/clients/repository.test.ts`
Expected: FAIL (or skipped if `TEST_DATABASE_URL` unset) — `repository.createClient` doesn't
yet accept the shape needed and `appointOfficer`/`ceaseOfficer` don't exist yet.

- [ ] **Step 3: Add row types and mapping functions**

In `src/features/clients/repository.ts`, add after `ContactRow` (around line 80):

```ts
type OfficerRow = {
  id: string;
  company_id: string;
  officer_type: OfficerType;
  name: string;
  identification_type: IdentificationType | null;
  identification_number: string | null;
  address: string | null;
  appointment_date: string | Date;
  cessation_date: string | Date | null;
};
```

Add to the `import type { ... } from "./types"` block: `IdentificationType`, `Officer`,
`OfficerType`, `AppointOfficerInput`, `CeaseOfficerInput`.

Add after `mapContact` (around line 139):

```ts
function mapOfficer(row: OfficerRow): Officer {
  return {
    id: row.id,
    companyId: row.company_id,
    officerType: row.officer_type,
    name: row.name,
    identificationType: row.identification_type,
    identificationNumber: row.identification_number,
    address: row.address,
    appointmentDate: dateOnly(row.appointment_date),
    cessationDate: row.cessation_date ? dateOnly(row.cessation_date) : null,
  };
}
```

- [ ] **Step 4: Hydrate officers in `hydrateClient`**

Add a new query to the `Promise.all` in `hydrateClient` (around line 310-363), alongside the
existing `contacts`/`timeline`/`history`/`documents` queries:

```ts
    const [contacts, officers, timeline, history, documents] = await Promise.all([
      client<ContactRow[]>`
        select id, company_id, name, role, email, phone, is_primary
        from company_contacts
        where company_id = ${id}
        order by is_primary desc, name asc
      `,
      client<OfficerRow[]>`
        select id, company_id, officer_type, name, identification_type,
               identification_number, address, appointment_date, cessation_date
        from officers
        where company_id = ${id}
        order by (cessation_date is not null), appointment_date desc
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
```

(`order by (cessation_date is not null), appointment_date desc` — `false` sorts before `true`
in Postgres, so currently-active officers (`cessation_date is null`) come first, then ceased
ones, each group newest-appointment-first.)

Then add `officers: officers.map(mapOfficer),` to the returned object, right after
`contacts: contacts.map(mapContact),` (around line 371) — this is deferred to Task 4 for
`shareholdings` since that query is added there; for now just add the `officers` line.

- [ ] **Step 5: Update `createClient` to seed the initial secretary officer**

Change the transaction body (around lines 480-513) from:

```ts
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
```

to:

```ts
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

        await tx`
          insert into officers (company_id, officer_type, name, appointment_date)
          values (${companyId}, 'secretary', ${input.companySecretary}, ${input.incorporationDate})
        `;

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
```

- [ ] **Step 6: Remove `companySecretary` from `updateClient`**

Remove it from `changedFields`'s comparison list and from the `update companies set ...`
clause. Change:

```ts
  function changedFields(before: ClientDetail, input: UpdateClientInput): string[] {
    const comparisons: [string, unknown, unknown][] = [
      ["companyName", before.companyName, input.companyName],
      ["registeredOffice", before.registeredOffice, input.registeredOffice],
      ["companySecretary", before.companySecretary, input.companySecretary],
      ["status", before.status, input.status],
      ["ownerId", before.ownerId, input.ownerId],
      ["teamId", before.teamId, input.teamId],
      ["packageId", before.packageId, input.packageId],
    ];

    return comparisons.filter(([, previous, next]) => previous !== next).map(([field]) => field);
  }
```

to:

```ts
  function changedFields(before: ClientDetail, input: UpdateClientInput): string[] {
    const comparisons: [string, unknown, unknown][] = [
      ["companyName", before.companyName, input.companyName],
      ["registeredOffice", before.registeredOffice, input.registeredOffice],
      ["status", before.status, input.status],
      ["ownerId", before.ownerId, input.ownerId],
      ["teamId", before.teamId, input.teamId],
      ["packageId", before.packageId, input.packageId],
    ];

    return comparisons.filter(([, previous, next]) => previous !== next).map(([field]) => field);
  }
```

And change the `update companies set ...` clause inside `updateClient` from:

```ts
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
```

to:

```ts
        await tx`
          update companies
          set company_name = ${input.companyName},
              registered_office = ${input.registeredOffice},
              status = ${input.status},
              assigned_owner_id = ${input.ownerId},
              assigned_team_id = ${input.teamId},
              service_package_id = ${input.packageId},
              updated_at = now()
          where id = ${input.id}
        `;
```

- [ ] **Step 7: Add `appointOfficer` and `ceaseOfficer`**

Add after `removeContact` (around line 683):

```ts
  async function appointOfficer(input: AppointOfficerInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        await hydrateOrThrow(tx, input.companyId);

        if (input.officerType === "secretary") {
          await tx`
            update officers
            set cessation_date = ${input.appointmentDate}, updated_at = now()
            where company_id = ${input.companyId}
              and officer_type = 'secretary'
              and cessation_date is null
          `;

          await tx`
            update companies set company_secretary = ${input.name}, updated_at = now()
            where id = ${input.companyId}
          `;
        }

        await tx`
          insert into officers (
            company_id, officer_type, name, identification_type,
            identification_number, address, appointment_date
          ) values (
            ${input.companyId}, ${input.officerType}, ${input.name}, ${input.identificationType},
            ${input.identificationNumber}, ${input.address}, ${input.appointmentDate}
          )
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "officer_appointed",
          actorId: input.actorId,
          description: `Appointed ${input.name} as ${input.officerType}.`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function assertOfficerBelongsToCompany(
    tx: TransactionSqlClient,
    companyId: string,
    officerId: string,
  ): Promise<OfficerRow> {
    const rows = await tx<OfficerRow[]>`
      select id, company_id, officer_type, name, identification_type,
             identification_number, address, appointment_date, cessation_date
      from officers
      where id = ${officerId} and company_id = ${companyId}
      limit 1
    `;

    const [row] = rows;

    if (!row) {
      throw new Error("Officer not found for this company.");
    }

    return row;
  }

  async function ceaseOfficer(input: CeaseOfficerInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        const officer = await assertOfficerBelongsToCompany(tx, input.companyId, input.officerId);

        await tx`
          update officers set cessation_date = ${input.cessationDate}, updated_at = now()
          where id = ${input.officerId} and company_id = ${input.companyId}
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "officer_ceased",
          actorId: input.actorId,
          description: `Ceased ${officer.name} as ${officer.officer_type}.`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }
```

(`appointOfficer`'s secretary-cessation `update` runs before the `insert` — it only touches
rows with `cessation_date is null`, so it can never accidentally re-cease the row being
inserted, since that row doesn't exist yet.)

- [ ] **Step 8: Add the new methods to the `ClientRepository` type and the returned object**

Add `appointOfficer` and `ceaseOfficer` to the `ClientRepository` type (around line 34-46) and
to the object returned at the end of `createClientRepository` (around line 691-703).

- [ ] **Step 9: Run the tests and typecheck**

Run: `npm run test -- src/features/clients/repository.test.ts`
Expected: PASS (including the two new integration tests, if `TEST_DATABASE_URL` is set; skipped
otherwise).

Run: `npm run typecheck`
Expected: errors remain only in `server-fns.ts` and `client-form-dialog.tsx` (still reference
the removed `UpdateClientInput.companySecretary`), and wherever `ClientDetail` construction is
incomplete without `shareholdings` (Task 4). Confirm no new errors from officer-related code.

- [ ] **Step 10: Commit**

```bash
git add src/features/clients/repository.ts src/features/clients/repository.test.ts
git commit -m "feat: add officer appointment/cessation with secretary sync"
```

---

### Task 4: Repository layer — shareholdings

**Files:**
- Modify: `src/features/clients/repository.ts`
- Modify: `src/features/clients/repository.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add to `src/features/clients/repository.test.ts`, in the same `describe.skipIf(!databaseUrl)`
block added in Task 3 (or a sibling one — match whichever style Task 3 actually used):

```ts
  it("records and ceases a shareholding independently of officers", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createClientRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`
            select id from users where active limit 1
          `;
          const [team] = await tx<{ id: string }[]>`
            select id from teams where active limit 1
          `;

          const client = await repository.createClient({
            companyName: "Shareholder Test Co Ltd",
            crNumber: `CR-SH-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-SH-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2020-01-15",
            annualReturnBasisDate: "2020-01-15",
            registeredOffice: "1 Test Street, Hong Kong",
            companySecretary: "A Secretary Ltd",
            ownerId: owner.id,
            teamId: team.id,
            packageId: null,
            contacts: [],
            actorId: owner.id,
          });

          expect(client.shareholdings).toEqual([]);

          const recorded = await repository.recordShareholding({
            companyId: client.id,
            shareholderName: "Jane Shareholder",
            shareholderAddress: "3 Test Street, Hong Kong",
            shareClass: "Ordinary",
            numberOfShares: 100,
            allotmentDate: "2020-01-15",
            actorId: owner.id,
          });

          const shareholding = recorded.shareholdings.find((s) => s.shareholderName === "Jane Shareholder");
          expect(shareholding).toBeDefined();
          expect(shareholding?.numberOfShares).toBe(100);
          expect(shareholding?.cessationDate).toBeNull();

          const ceased = await repository.ceaseShareholding({
            companyId: client.id,
            shareholdingId: shareholding!.id,
            cessationDate: "2026-06-01",
            actorId: owner.id,
          });

          expect(
            ceased.shareholdings.find((s) => s.id === shareholding!.id)?.cessationDate,
          ).toBe("2026-06-01");

          throw new Error("rollback shareholdings integration fixture");
        }),
      ).rejects.toThrow("rollback shareholdings integration fixture");
    } finally {
      await sql.end();
    }
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- src/features/clients/repository.test.ts`
Expected: FAIL (or skipped without `TEST_DATABASE_URL`) — `recordShareholding`/
`ceaseShareholding` don't exist yet, and `ClientDetail.shareholdings` isn't hydrated.

- [ ] **Step 3: Add the shareholding row type and mapping function**

Add after `OfficerRow` (added in Task 3):

```ts
type ShareholdingRow = {
  id: string;
  company_id: string;
  shareholder_name: string;
  shareholder_address: string | null;
  share_class: string;
  number_of_shares: number;
  allotment_date: string | Date;
  cessation_date: string | Date | null;
};
```

Add to the `import type { ... } from "./types"` block: `Shareholding`,
`RecordShareholdingInput`, `CeaseShareholdingInput`.

Add after `mapOfficer`:

```ts
function mapShareholding(row: ShareholdingRow): Shareholding {
  return {
    id: row.id,
    companyId: row.company_id,
    shareholderName: row.shareholder_name,
    shareholderAddress: row.shareholder_address,
    shareClass: row.share_class,
    numberOfShares: row.number_of_shares,
    allotmentDate: dateOnly(row.allotment_date),
    cessationDate: row.cessation_date ? dateOnly(row.cessation_date) : null,
  };
}
```

- [ ] **Step 4: Hydrate shareholdings in `hydrateClient`**

Extend the `Promise.all` destructuring and query list from Task 3's Step 4 to also fetch
shareholdings:

```ts
    const [contacts, officers, shareholdings, timeline, history, documents] = await Promise.all([
      client<ContactRow[]>`
        select id, company_id, name, role, email, phone, is_primary
        from company_contacts
        where company_id = ${id}
        order by is_primary desc, name asc
      `,
      client<OfficerRow[]>`
        select id, company_id, officer_type, name, identification_type,
               identification_number, address, appointment_date, cessation_date
        from officers
        where company_id = ${id}
        order by (cessation_date is not null), appointment_date desc
      `,
      client<ShareholdingRow[]>`
        select id, company_id, shareholder_name, shareholder_address, share_class,
               number_of_shares, allotment_date, cessation_date
        from shareholdings
        where company_id = ${id}
        order by (cessation_date is not null), allotment_date desc
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
```

Then add `shareholdings: shareholdings.map(mapShareholding),` to the returned object, right
after `officers: officers.map(mapOfficer),` (added in Task 3).

- [ ] **Step 5: Add `recordShareholding` and `ceaseShareholding`**

Add after `ceaseOfficer` (added in Task 3):

```ts
  async function recordShareholding(input: RecordShareholdingInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        await hydrateOrThrow(tx, input.companyId);

        await tx`
          insert into shareholdings (
            company_id, shareholder_name, shareholder_address, share_class,
            number_of_shares, allotment_date
          ) values (
            ${input.companyId}, ${input.shareholderName}, ${input.shareholderAddress},
            ${input.shareClass}, ${input.numberOfShares}, ${input.allotmentDate}
          )
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "shareholding_recorded",
          actorId: input.actorId,
          description: `Recorded shareholding for ${input.shareholderName} (${input.numberOfShares} ${input.shareClass} shares).`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function assertShareholdingBelongsToCompany(
    tx: TransactionSqlClient,
    companyId: string,
    shareholdingId: string,
  ): Promise<ShareholdingRow> {
    const rows = await tx<ShareholdingRow[]>`
      select id, company_id, shareholder_name, shareholder_address, share_class,
             number_of_shares, allotment_date, cessation_date
      from shareholdings
      where id = ${shareholdingId} and company_id = ${companyId}
      limit 1
    `;

    const [row] = rows;

    if (!row) {
      throw new Error("Shareholding not found for this company.");
    }

    return row;
  }

  async function ceaseShareholding(input: CeaseShareholdingInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        const shareholding = await assertShareholdingBelongsToCompany(
          tx,
          input.companyId,
          input.shareholdingId,
        );

        await tx`
          update shareholdings set cessation_date = ${input.cessationDate}, updated_at = now()
          where id = ${input.shareholdingId} and company_id = ${input.companyId}
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "shareholding_ceased",
          actorId: input.actorId,
          description: `Ceased shareholding for ${shareholding.shareholder_name}.`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }
```

- [ ] **Step 6: Add the new methods to `ClientRepository` and the returned object**

Add `recordShareholding` and `ceaseShareholding` to the `ClientRepository` type and to the
object returned at the end of `createClientRepository`.

- [ ] **Step 7: Run the tests and typecheck**

Run: `npm run test -- src/features/clients/repository.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: errors remain only in `server-fns.ts` and `client-form-dialog.tsx`. Confirm
`repository.ts` itself is now fully clean.

- [ ] **Step 8: Commit**

```bash
git add src/features/clients/repository.ts src/features/clients/repository.test.ts
git commit -m "feat: add shareholding recording and cessation"
```

---

### Task 5: Server-fns layer and client-form-dialog fix

**Files:**
- Modify: `src/features/clients/server-fns.ts`
- Modify: `src/components/clients/client-form-dialog.tsx`

- [ ] **Step 1: Remove `companySecretary` from `updateClientSchema`**

Change:

```ts
const updateClientSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string().min(1),
  registeredOffice: z.string().min(1),
  companySecretary: z.string().min(1),
  status: z.enum(["active", "inactive"]),
  ownerId: z.string().uuid(),
  teamId: z.string().uuid(),
  packageId: z.string().uuid().nullable(),
});
```

to:

```ts
const updateClientSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string().min(1),
  registeredOffice: z.string().min(1),
  status: z.enum(["active", "inactive"]),
  ownerId: z.string().uuid(),
  teamId: z.string().uuid(),
  packageId: z.string().uuid().nullable(),
});
```

- [ ] **Step 2: Remove `companySecretary` from `client-form-dialog.tsx`'s update payload**

In `src/components/clients/client-form-dialog.tsx`'s `submit` function, remove the
`companySecretary: form.companySecretary,` line from the `updateClient({ data: {...} })` call
(around line 143) — leave the `createClient({ data: {...} })` call's
`companySecretary: form.companySecretary,` line (around line 162) untouched, since creation
still needs it to seed both the company row and the initial secretary officer.

- [ ] **Step 3: Add the new Zod schemas**

Add after `removeContactSchema`:

```ts
const appointOfficerSchema = z.object({
  companyId: z.string().uuid(),
  officerType: z.enum(["director", "secretary"]),
  name: z.string().min(1),
  identificationType: z.enum(["hkid", "passport", "br_number"]).nullable(),
  identificationNumber: z.string().nullable(),
  address: z.string().nullable(),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const ceaseOfficerSchema = z.object({
  companyId: z.string().uuid(),
  officerId: z.string().uuid(),
  cessationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const recordShareholdingSchema = z.object({
  companyId: z.string().uuid(),
  shareholderName: z.string().min(1),
  shareholderAddress: z.string().nullable(),
  shareClass: z.string().min(1),
  numberOfShares: z.number().int().positive(),
  allotmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const ceaseShareholdingSchema = z.object({
  companyId: z.string().uuid(),
  shareholdingId: z.string().uuid(),
  cessationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
```

- [ ] **Step 4: Add the new server fns**

Add after `removeClientContact`, following the exact `requireWritableCompany` +
`withClientRepository` shape every other mutation in this file uses:

```ts
export const appointClientOfficer = createServerFn({ method: "POST" })
  .validator(appointOfficerSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.appointOfficer({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const ceaseClientOfficer = createServerFn({ method: "POST" })
  .validator(ceaseOfficerSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.ceaseOfficer({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const recordClientShareholding = createServerFn({ method: "POST" })
  .validator(recordShareholdingSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.recordShareholding({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const ceaseClientShareholding = createServerFn({ method: "POST" })
  .validator(ceaseShareholdingSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.ceaseShareholding({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );
```

- [ ] **Step 5: Run typecheck and the full test suite**

Run: `npm run typecheck`
Expected: fully clean — every file has now been updated for the `companySecretary` removal and
the new officer/shareholding shapes.

Run: `npm run test`
Expected: PASS, no regressions. (The two new dialogs and detail-page sections don't exist yet —
Tasks 6-8 — so nothing references the new server fns from the UI side yet; that's expected.)

- [ ] **Step 6: Commit**

```bash
git add src/features/clients/server-fns.ts src/components/clients/client-form-dialog.tsx
git commit -m "feat: add officer and shareholding server functions"
```

---

### Task 6: `OfficerFormDialog` component

**Files:**
- Create: `src/components/clients/officer-form-dialog.tsx`
- Test: `src/components/clients/officer-form-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfficerFormDialog } from "./officer-form-dialog";

const serverFns = vi.hoisted(() => ({
  appointClientOfficer: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  appointClientOfficer: serverFns.appointClientOfficer,
}));

describe("OfficerFormDialog", () => {
  beforeEach(() => {
    serverFns.appointClientOfficer.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("appoints a director with the entered fields", async () => {
    serverFns.appointClientOfficer.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <OfficerFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Director" } });
    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Appoint officer" }));

    await waitFor(() =>
      expect(serverFns.appointClientOfficer).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          officerType: "director",
          name: "Jane Director",
          identificationType: null,
          identificationNumber: null,
          address: null,
          appointmentDate: "2026-01-01",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.appointClientOfficer.mockRejectedValue(new Error("Officer not found for this company."));

    render(
      <OfficerFormDialog open onOpenChange={() => {}} companyId="company-1" onSaved={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Director" } });
    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Appoint officer" }));

    expect(await screen.findByText("Officer not found for this company.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- src/components/clients/officer-form-dialog.test.tsx`
Expected: FAIL — `Cannot find module './officer-form-dialog'`.

- [ ] **Step 3: Implement the component**

Mirror `contact-form-dialog.tsx`'s shape exactly (plain `useState`, `useEffect` reset-on-open,
inline error state, no react-hook-form):

```tsx
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { appointClientOfficer } from "@/features/clients/server-fns";
import type { IdentificationType, OfficerType } from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onSaved: () => void;
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

const today = () => new Date().toISOString().slice(0, 10);

export function OfficerFormDialog({ open, onOpenChange, companyId, onSaved }: Props) {
  const [officerType, setOfficerType] = useState<OfficerType>("director");
  const [name, setName] = useState("");
  const [identificationType, setIdentificationType] = useState<IdentificationType | "">("");
  const [identificationNumber, setIdentificationNumber] = useState("");
  const [address, setAddress] = useState("");
  const [appointmentDate, setAppointmentDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setOfficerType("director");
    setName("");
    setIdentificationType("");
    setIdentificationNumber("");
    setAddress("");
    setAppointmentDate(today());
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      await appointClientOfficer({
        data: {
          companyId,
          officerType,
          name,
          identificationType: identificationType || null,
          identificationNumber: identificationNumber.trim() || null,
          address: address.trim() || null,
          appointmentDate,
        },
      });

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to appoint the officer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Appoint officer</DialogTitle>
          <DialogDescription>
            Appointing a new secretary automatically supersedes the current one.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="officer-form-type">
              Type
            </label>
            <select
              id="officer-form-type"
              className={inputClass}
              value={officerType}
              onChange={(event) => setOfficerType(event.target.value as OfficerType)}
            >
              <option value="director">Director</option>
              <option value="secretary">Secretary</option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="officer-form-name">
              Name
            </label>
            <input
              id="officer-form-name"
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="officer-form-id-type">
                Identification type
              </label>
              <select
                id="officer-form-id-type"
                className={inputClass}
                value={identificationType}
                onChange={(event) =>
                  setIdentificationType(event.target.value as IdentificationType | "")
                }
              >
                <option value="">Not on file</option>
                <option value="hkid">HKID</option>
                <option value="passport">Passport</option>
                <option value="br_number">BR number (corporate)</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="officer-form-id-number">
                Identification number
              </label>
              <input
                id="officer-form-id-number"
                className={inputClass}
                value={identificationNumber}
                onChange={(event) => setIdentificationNumber(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="officer-form-address">
              Address
            </label>
            <input
              id="officer-form-address"
              className={inputClass}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="officer-form-appointment-date">
              Appointment date
            </label>
            <input
              id="officer-form-appointment-date"
              type="date"
              className={inputClass}
              value={appointmentDate}
              onChange={(event) => setAppointmentDate(event.target.value)}
              required
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Appoint officer"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Note: the test uses `screen.getByLabelText("Name")` and `"Appointment date"` — these match the
`<label>` text associated with `officer-form-name` and `officer-form-appointment-date` via
`htmlFor`, which Testing Library resolves automatically.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test -- src/components/clients/officer-form-dialog.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/components/clients/officer-form-dialog.tsx src/components/clients/officer-form-dialog.test.tsx
git commit -m "feat: add the officer appointment dialog"
```

---

### Task 7: `ShareholdingFormDialog` component

**Files:**
- Create: `src/components/clients/shareholding-form-dialog.tsx`
- Test: `src/components/clients/shareholding-form-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareholdingFormDialog } from "./shareholding-form-dialog";

const serverFns = vi.hoisted(() => ({
  recordClientShareholding: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  recordClientShareholding: serverFns.recordClientShareholding,
}));

describe("ShareholdingFormDialog", () => {
  beforeEach(() => {
    serverFns.recordClientShareholding.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("records a shareholding with the entered fields", async () => {
    serverFns.recordClientShareholding.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <ShareholdingFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shareholder name"), {
      target: { value: "Jane Shareholder" },
    });
    fireEvent.change(screen.getByLabelText("Number of shares"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Allotment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record shareholding" }));

    await waitFor(() =>
      expect(serverFns.recordClientShareholding).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          shareholderName: "Jane Shareholder",
          shareholderAddress: null,
          shareClass: "Ordinary",
          numberOfShares: 100,
          allotmentDate: "2026-01-01",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.recordClientShareholding.mockRejectedValue(new Error("Client not found."));

    render(
      <ShareholdingFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shareholder name"), {
      target: { value: "Jane Shareholder" },
    });
    fireEvent.change(screen.getByLabelText("Number of shares"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Allotment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record shareholding" }));

    expect(await screen.findByText("Client not found.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- src/components/clients/shareholding-form-dialog.test.tsx`
Expected: FAIL — `Cannot find module './shareholding-form-dialog'`.

- [ ] **Step 3: Implement the component**

```tsx
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { recordClientShareholding } from "@/features/clients/server-fns";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onSaved: () => void;
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

const today = () => new Date().toISOString().slice(0, 10);

export function ShareholdingFormDialog({ open, onOpenChange, companyId, onSaved }: Props) {
  const [shareholderName, setShareholderName] = useState("");
  const [shareholderAddress, setShareholderAddress] = useState("");
  const [shareClass, setShareClass] = useState("Ordinary");
  const [numberOfShares, setNumberOfShares] = useState("");
  const [allotmentDate, setAllotmentDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setShareholderName("");
    setShareholderAddress("");
    setShareClass("Ordinary");
    setNumberOfShares("");
    setAllotmentDate(today());
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const parsedShares = Number.parseInt(numberOfShares, 10);

    if (!Number.isInteger(parsedShares) || parsedShares <= 0) {
      setError("Enter a whole number of shares greater than zero.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      await recordClientShareholding({
        data: {
          companyId,
          shareholderName,
          shareholderAddress: shareholderAddress.trim() || null,
          shareClass,
          numberOfShares: parsedShares,
          allotmentDate,
        },
      });

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the shareholding.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record shareholding</DialogTitle>
          <DialogDescription>Record a member of this company's share register.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="shareholding-form-name">
              Shareholder name
            </label>
            <input
              id="shareholding-form-name"
              className={inputClass}
              value={shareholderName}
              onChange={(event) => setShareholderName(event.target.value)}
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="shareholding-form-address">
              Address
            </label>
            <input
              id="shareholding-form-address"
              className={inputClass}
              value={shareholderAddress}
              onChange={(event) => setShareholderAddress(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="shareholding-form-class">
                Share class
              </label>
              <input
                id="shareholding-form-class"
                className={inputClass}
                value={shareClass}
                onChange={(event) => setShareClass(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="shareholding-form-number">
                Number of shares
              </label>
              <input
                id="shareholding-form-number"
                type="number"
                min="1"
                step="1"
                className={inputClass}
                value={numberOfShares}
                onChange={(event) => setNumberOfShares(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="shareholding-form-date">
                Allotment date
              </label>
              <input
                id="shareholding-form-date"
                type="date"
                className={inputClass}
                value={allotmentDate}
                onChange={(event) => setAllotmentDate(event.target.value)}
                required
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Record shareholding"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test -- src/components/clients/shareholding-form-dialog.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/components/clients/shareholding-form-dialog.tsx src/components/clients/shareholding-form-dialog.test.tsx
git commit -m "feat: add the shareholding recording dialog"
```

---

### Task 8: Wire the two new sections into `production-client-detail.tsx`

**Files:**
- Modify: `src/features/clients/components/production-client-detail.tsx`
- Test: `src/features/clients/components/production-client-detail.interaction.test.tsx` (check
  whether this file already exists from P1-3; if so extend it, otherwise this task creates it
  following the same fixture/mocking pattern as `production-client-register.interaction.test.tsx`)

- [ ] **Step 1: Add state, invalidation wiring, and imports**

Add imports:

```ts
import { OfficerFormDialog } from "@/components/clients/officer-form-dialog";
import { ShareholdingFormDialog } from "@/components/clients/shareholding-form-dialog";
import { ceaseClientOfficer, ceaseClientShareholding } from "../server-fns";
```

(these join the existing `getClient, listClientAssignmentOptions, removeClientContact` import
from `../server-fns`, and `Officer`/`Shareholding` join the existing type import from
`../types` if referenced directly — they aren't strictly needed as explicit imports since the
sections map over `client.officers`/`client.shareholdings`, whose element types are already
inferred).

Add state alongside the existing `isEditOpen`/`contactDialog`/`removingContactId`:

```ts
  const [isOfficerDialogOpen, setIsOfficerDialogOpen] = useState(false);
  const [isShareholdingDialogOpen, setIsShareholdingDialogOpen] = useState(false);
  const [ceasingOfficerId, setCeasingOfficerId] = useState<string | null>(null);
  const [ceasingShareholdingId, setCeasingShareholdingId] = useState<string | null>(null);
```

Add handlers alongside `handleRemoveContact`, following its exact try/catch/finally +
`toast.error` shape:

```ts
  async function handleCeaseOfficer(officerId: string) {
    setCeasingOfficerId(officerId);

    try {
      await ceaseClientOfficer({
        data: { companyId: clientId, officerId, cessationDate: new Date().toISOString().slice(0, 10) },
      });
      invalidate();
    } catch {
      toast.error("Unable to cease the officer. Try again.");
    } finally {
      setCeasingOfficerId(null);
    }
  }

  async function handleCeaseShareholding(shareholdingId: string) {
    setCeasingShareholdingId(shareholdingId);

    try {
      await ceaseClientShareholding({
        data: {
          companyId: clientId,
          shareholdingId,
          cessationDate: new Date().toISOString().slice(0, 10),
        },
      });
      invalidate();
    } catch {
      toast.error("Unable to cease the shareholding. Try again.");
    } finally {
      setCeasingShareholdingId(null);
    }
  }
```

- [ ] **Step 2: Add tone maps and the two sections**

Add alongside the existing `companyStatusTone`/`paymentStatusTone`/`verificationTone` maps:

```ts
const officerTypeLabel: Record<"director" | "secretary", string> = {
  director: "Director",
  secretary: "Secretary",
};
```

Insert two new `<section>` blocks between the closing `</section>` of the Overview card
(after line 156, `</section>`) and the opening `<section>` of Contacts (line 158):

```tsx
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Officers</h2>
          <button
            type="button"
            onClick={() => setIsOfficerDialogOpen(true)}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Appoint officer
          </button>
        </div>
        <div className="divide-y">
          {client.officers.map((officer) => (
            <div key={officer.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {officer.name}
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {officerTypeLabel[officer.officerType]}
                  </span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Appointed {officer.appointmentDate}
                  {officer.cessationDate ? ` · Ceased ${officer.cessationDate}` : ""}
                  {officer.identificationNumber ? ` · ${officer.identificationNumber}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={officer.cessationDate ? "neutral" : "green"}>
                  {officer.cessationDate ? "Ceased" : "Active"}
                </StatusPill>
                {!officer.cessationDate ? (
                  <button
                    type="button"
                    onClick={() => void handleCeaseOfficer(officer.id)}
                    disabled={ceasingOfficerId === officer.id}
                    className="rounded-md border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    Cease
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {client.officers.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No officers on file.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Shareholders</h2>
          <button
            type="button"
            onClick={() => setIsShareholdingDialogOpen(true)}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Record shareholding
          </button>
        </div>
        <div className="divide-y">
          {client.shareholdings.map((shareholding) => (
            <div key={shareholding.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{shareholding.shareholderName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {shareholding.numberOfShares} {shareholding.shareClass} shares · Allotted{" "}
                  {shareholding.allotmentDate}
                  {shareholding.cessationDate ? ` · Ceased ${shareholding.cessationDate}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={shareholding.cessationDate ? "neutral" : "green"}>
                  {shareholding.cessationDate ? "Ceased" : "Active"}
                </StatusPill>
                {!shareholding.cessationDate ? (
                  <button
                    type="button"
                    onClick={() => void handleCeaseShareholding(shareholding.id)}
                    disabled={ceasingShareholdingId === shareholding.id}
                    className="rounded-md border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    Cease
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {client.shareholdings.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No shareholdings on file.</p>
          ) : null}
        </div>
      </section>
```

- [ ] **Step 3: Render the two new dialogs**

Add alongside the existing `<ContactFormDialog>` render, near the end of the component's JSX
(after the `<ContactFormDialog ... />` block, before the closing `</main>`):

```tsx
      <OfficerFormDialog
        open={isOfficerDialogOpen}
        onOpenChange={setIsOfficerDialogOpen}
        companyId={clientId}
        onSaved={invalidate}
      />

      <ShareholdingFormDialog
        open={isShareholdingDialogOpen}
        onOpenChange={setIsShareholdingDialogOpen}
        companyId={clientId}
        onSaved={invalidate}
      />
```

- [ ] **Step 4: Write/extend interaction tests**

Check whether `src/features/clients/components/production-client-detail.interaction.test.tsx`
already exists (it should, from P1-3). If it does, extend its `makeClient()` fixture builder to
include `officers: []` and `shareholdings: []` in its default return value (required now that
`ClientDetail` has these fields — every existing test constructing a fixture via that builder
needs this or it won't typecheck), then add two new test cases:

```tsx
  it("renders officers and shareholdings, and ceases an officer on click", async () => {
    serverFns.getClient.mockResolvedValue(
      makeClient({
        officers: [
          {
            id: "officer-1",
            companyId: clientId,
            officerType: "secretary",
            name: "Kossilon Secretaries Ltd",
            identificationType: null,
            identificationNumber: null,
            address: null,
            appointmentDate: "2020-01-15",
            cessationDate: null,
          },
        ],
        shareholdings: [
          {
            id: "shareholding-1",
            companyId: clientId,
            shareholderName: "Jane Shareholder",
            shareholderAddress: null,
            shareClass: "Ordinary",
            numberOfShares: 100,
            allotmentDate: "2020-01-15",
            cessationDate: null,
          },
        ],
      }),
    );
    serverFns.ceaseClientOfficer.mockResolvedValue({});
    renderDetail();

    await screen.findByText("Kossilon Secretaries Ltd");
    expect(screen.getByText("Jane Shareholder")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cease" }));

    await waitFor(() =>
      expect(serverFns.ceaseClientOfficer).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: clientId, officerId: "officer-1" }),
      }),
    );
  });
```

Add `ceaseClientOfficer: vi.fn()` and `ceaseClientShareholding: vi.fn()` to the file's existing
`vi.hoisted(() => ({ ... }))` server-fn mock object and `vi.mock("../server-fns", () => ({
...}))` factory, matching how `getClient`/`removeClientContact` are already mocked there, and
reset both in the existing `beforeEach`.

If no interaction test file exists yet for this component, create one following
`production-client-register.interaction.test.tsx`'s exact structure (imports, `vi.hoisted`
server-fn mocks, `renderDetail()`/`renderRegister()`-style helper, `QueryClientProvider` wrapper)
instead of the extension described above.

- [ ] **Step 5: Run the tests and full verification**

Run: `npm run test -- src/features/clients/components/production-client-detail.interaction.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: fully clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/clients/components/production-client-detail.tsx src/features/clients/components/production-client-detail.interaction.test.tsx
git commit -m "feat: add officers and shareholders sections to the client detail screen"
```

---

### Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS, all suites green, same or higher total test count than before this plan
(baseline before this branch: 109 files / 794 tests, 96 skipped).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS, no new errors (the one pre-existing `work-queue.tsx` warning is unrelated).

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: Confirm the DB-integration suite passes against a real database, if reachable**

If `TEST_DATABASE_URL` is set, confirm the new officers/shareholdings integration tests from
Tasks 3 and 4 pass against a real Postgres instance — this is the one place the secretary-sync
transaction logic and the new CHECK constraints actually get exercised. If not set, note that
explicitly rather than treating the skip as a pass, and recommend confirming CI is green before
merging.

- [ ] **Step 5: Repo-wide sweep for stale `companySecretary` references**

Per the lesson from the P1-4 (`work_items.case_id`) migration: run
`grep -rn "companySecretary" src` and confirm every remaining hit is either (a) the
`CreateClientInput.companySecretary` field (still legitimate — creation still collects it) or
(b) the `ClientDetail.companySecretary` read-only display field (still legitimate — it's the
denormalized, kept-in-sync value). Confirm there is no remaining place that treats it as
independently writable outside of `createClient`'s initial-officer-seeding path.

- [ ] **Step 6: Manual smoke test**

Start the dev server, sign in as a production user, open an existing client's detail page, and
confirm: the Officers and Shareholders sections render; appointing a new secretary via "Appoint
officer" updates the "Company secretary" field in the Overview card above without a manual
reload; ceasing a director/shareholder updates its status pill immediately.

No commit for this task — it is verification of Tasks 1-8.
