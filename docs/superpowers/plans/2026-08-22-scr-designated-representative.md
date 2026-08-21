# P1-6: SCR + Designated Representative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the significant-controllers register, add Designated Representative (DR)
as a third officer type, and add a simple inspection-request log, per
`docs/superpowers/specs/2026-08-22-scr-designated-representative-design.md`.

**Architecture:** Extends the existing `src/features/clients/` slice exactly the way
P1-5 added officers/shareholdings — two new tables (`significant_controllers`,
`scr_inspection_requests`), a third `officers.officer_type` value, new repository
methods and server fns, and two new sections on `/clients/$id`. No new feature module,
no new route, no demo-mode work (this screen has no fixture-backed demo tier).

**Tech Stack:** TanStack Start, Postgres via `postgres` (raw SQL), Zod, Vitest, React 19.

---

## Task 1: Migration and schema.sql

**Files:**
- Create: `db/migrations/0016_significant_controllers_and_dr.sql`
- Modify: `src/server/db/schema.sql:657-676`

- [ ] **Step 1: Write the migration**

```sql
-- 0016: significant controllers register + Designated Representative (P1-6).
--
-- No structured significant-controller or inspection-request data has existed
-- anywhere in this schema — "significant control" appears only as demo fixture
-- text, and "designated represent" has zero hits repo-wide. This closes the
-- highest-liability gap in the roadmap catalogue (non-compliance exposure up to
-- HK$25,000 plus a daily fine). Purely additive except for widening
-- officers.officer_type, which has no other consumer of its current two-value
-- assumption (grepped repo-wide: only `officer_type in (...)` itself and the
-- Zod enum in clients/server-fns.ts reference the value list).

create table if not exists significant_controllers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  controller_name text not null,
  identification_type text check (identification_type in ('hkid', 'passport', 'br_number')),
  identification_number text,
  address text,
  control_bases text[] not null,
  registered_date date not null,
  cessation_date date,
  register_update_due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint significant_controllers_cessation_after_registered check (
    cessation_date is null or cessation_date >= registered_date
  ),
  constraint significant_controllers_control_bases_valid check (
    control_bases <@ array['shares_over_25pct', 'votes_over_25pct',
                            'board_appointment_right', 'significant_influence']::text[]
    and cardinality(control_bases) > 0
  )
);

create index if not exists significant_controllers_company_idx on significant_controllers (company_id);

create table if not exists scr_inspection_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  requester_name text not null,
  requester_authority text not null,
  request_date date not null,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scr_inspection_requests_company_idx on scr_inspection_requests (company_id);

-- officers.officer_type's current constraint is the inline, unnamed
-- `check (officer_type in ('director', 'secretary'))` from migration 0015,
-- which Postgres names by its standard <table>_<column>_check rule.
alter table officers drop constraint if exists officers_officer_type_check;
alter table officers add constraint officers_officer_type_check
  check (officer_type in ('director', 'secretary', 'designated_representative'));
```

- [ ] **Step 2: Update `schema.sql` to match**

`schema.sql` is a from-scratch reference doc reflecting final state (not migration
history) — confirmed by how migration 0014's `work_items.case_type` alter shows up
in `schema.sql` as a plain final column, not as a before/after pair. Apply the same
treatment here: `officers`'s check constraint gets its final three-value list
in-place, and the two new tables are inserted after `shareholdings`'s index
(`src/server/db/schema.sql:657`), replacing the `officer_type in (...)` line at
`schema.sql:643` and inserting the two new tables before the existing comment block
at line 677:

```sql
  officer_type text not null check (officer_type in ('director', 'secretary', 'designated_representative')),
```

Insert immediately after line 675 (`create index if not exists shareholdings_company_idx on shareholdings (company_id);`), before the `-- ---...` comment block:

```sql

create table if not exists significant_controllers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  controller_name text not null,
  identification_type text check (identification_type in ('hkid', 'passport', 'br_number')),
  identification_number text,
  address text,
  control_bases text[] not null,
  registered_date date not null,
  cessation_date date,
  register_update_due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint significant_controllers_cessation_after_registered check (
    cessation_date is null or cessation_date >= registered_date
  ),
  constraint significant_controllers_control_bases_valid check (
    control_bases <@ array['shares_over_25pct', 'votes_over_25pct',
                            'board_appointment_right', 'significant_influence']::text[]
    and cardinality(control_bases) > 0
  )
);

create index if not exists significant_controllers_company_idx on significant_controllers (company_id);

create table if not exists scr_inspection_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  requester_name text not null,
  requester_authority text not null,
  request_date date not null,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scr_inspection_requests_company_idx on scr_inspection_requests (company_id);
```

- [ ] **Step 3: Verify the migration/schema consistency gate**

Run: `npm run verify:firm -- --dry-run`
Expected: passes, including its `migration-schema` check (parses table names out of
`db/migrations/*.sql` and confirms each appears in `schema.sql`). This runs entirely
offline — no `TEST_DATABASE_URL` needed.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0016_significant_controllers_and_dr.sql src/server/db/schema.sql
git commit -m "feat: add significant_controllers and scr_inspection_requests tables"
```

---

## Task 2: Types

**Files:**
- Modify: `src/features/clients/types.ts`

- [ ] **Step 1: Add the new types**

Change line 24 from:

```ts
export type OfficerType = "director" | "secretary";
```

to:

```ts
export type OfficerType = "director" | "secretary" | "designated_representative";

export type ControlBasis =
  | "shares_over_25pct"
  | "votes_over_25pct"
  | "board_appointment_right"
  | "significant_influence";
```

After the `Shareholding` type (line 48), add:

```ts
export type SignificantController = {
  id: string;
  companyId: string;
  controllerName: string;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  address: string | null;
  controlBases: ControlBasis[];
  registeredDate: string;
  cessationDate: string | null;
  registerUpdateDueDate: string | null;
};

export type InspectionRequest = {
  id: string;
  companyId: string;
  requesterName: string;
  requesterAuthority: string;
  requestDate: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
};
```

In `ClientDetail` (currently at line 98-109), add two fields after `shareholdings`:

```ts
export type ClientDetail = ClientSummary & {
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  contacts: CompanyContact[];
  officers: Officer[];
  shareholdings: Shareholding[];
  significantControllers: SignificantController[];
  inspectionRequests: InspectionRequest[];
  timeline: ClientTimelineEntry[];
  annualReturnHistory: ClientAnnualReturnEntry[];
  documents: ClientDocument[];
};
```

At the end of the file, after `CeaseShareholdingInput` (line 197-202), add:

```ts
export type RecordControllerInput = {
  companyId: string;
  controllerName: string;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  address: string | null;
  controlBases: ControlBasis[];
  registeredDate: string;
  registerUpdateDueDate: string | null;
  actorId: string;
};

export type UpdateControllerParticularsInput = {
  companyId: string;
  controllerId: string;
  address: string | null;
  controlBases: ControlBasis[];
  registerUpdateDueDate: string | null;
  actorId: string;
};

export type CeaseControllerInput = {
  companyId: string;
  controllerId: string;
  cessationDate: string;
  actorId: string;
};

export type RecordInspectionRequestInput = {
  companyId: string;
  requesterName: string;
  requesterAuthority: string;
  requestDate: string;
  actorId: string;
};

export type ResolveInspectionRequestInput = {
  companyId: string;
  inspectionRequestId: string;
  resolutionNote: string;
  actorId: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: new errors only in `repository.ts`/`server-fns.ts`/components that haven't
been updated yet (they reference the old `OfficerType`/`ClientDetail` shape) — this is
expected, sequencing-only breakage that later tasks fix, not a defect in this task.

- [ ] **Step 3: Commit**

```bash
git add src/features/clients/types.ts
git commit -m "feat: add significant-controller and inspection-request types"
```

---

## Task 3: Repository layer

**Files:**
- Modify: `src/features/clients/repository.ts`

- [ ] **Step 1: Add row types and imports**

Add to the import list from `./types` (after `Shareholding`):

```ts
  RecordControllerInput,
  RecordInspectionRequestInput,
  ResolveInspectionRequestInput,
  SignificantController,
  ControlBasis,
  InspectionRequest,
  UpdateControllerParticularsInput,
  CeaseControllerInput,
```

After `ShareholdingRow` (line 106-115), add:

```ts
type SignificantControllerRow = {
  id: string;
  company_id: string;
  controller_name: string;
  identification_type: IdentificationType | null;
  identification_number: string | null;
  address: string | null;
  control_bases: ControlBasis[];
  registered_date: string | Date;
  cessation_date: string | Date | null;
  register_update_due_date: string | Date | null;
};

type InspectionRequestRow = {
  id: string;
  company_id: string;
  requester_name: string;
  requester_authority: string;
  request_date: string | Date;
  resolution_note: string | null;
  resolved_at: string | Date | null;
};
```

- [ ] **Step 2: Add mapper functions**

After `mapShareholding` (line 190-201), add:

```ts
function mapController(row: SignificantControllerRow): SignificantController {
  return {
    id: row.id,
    companyId: row.company_id,
    controllerName: row.controller_name,
    identificationType: row.identification_type,
    identificationNumber: row.identification_number,
    address: row.address,
    controlBases: row.control_bases,
    registeredDate: dateOnly(row.registered_date),
    cessationDate: row.cessation_date ? dateOnly(row.cessation_date) : null,
    registerUpdateDueDate: row.register_update_due_date
      ? dateOnly(row.register_update_due_date)
      : null,
  };
}

function mapInspectionRequest(row: InspectionRequestRow): InspectionRequest {
  return {
    id: row.id,
    companyId: row.company_id,
    requesterName: row.requester_name,
    requesterAuthority: row.requester_authority,
    requestDate: dateOnly(row.request_date),
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at ? timestampString(row.resolved_at) : null,
  };
}
```

- [ ] **Step 3: Extend `hydrateClient` to fetch both new tables**

In the `Promise.all` array (line 372-439), add two more queries. Change the
destructuring on line 372 from:

```ts
    const [contacts, officers, shareholdings, timeline, history, documents] = await Promise.all([
```

to:

```ts
    const [
      contacts,
      officers,
      shareholdings,
      significantControllers,
      inspectionRequests,
      timeline,
      history,
      documents,
    ] = await Promise.all([
```

Insert two new queries after the `shareholdings` query (after line 392, before the
`timeline` query):

```ts
      client<SignificantControllerRow[]>`
        select id, company_id, controller_name, identification_type, identification_number,
               address, control_bases, registered_date, cessation_date, register_update_due_date
        from significant_controllers
        where company_id = ${id}
        order by (cessation_date is not null), registered_date desc
      `,
      client<InspectionRequestRow[]>`
        select id, company_id, requester_name, requester_authority, request_date,
               resolution_note, resolved_at
        from scr_inspection_requests
        where company_id = ${id}
        order by request_date desc
      `,
```

In the returned object (line 441-478), add two fields after `shareholdings:`:

```ts
      significantControllers: significantControllers.map(mapController),
      inspectionRequests: inspectionRequests.map(mapInspectionRequest),
```

- [ ] **Step 4: Generalize the secretary-sync branch in `appointOfficer` to cover DR**

Change line 772 from:

```ts
        if (input.officerType === "secretary") {
```

to:

```ts
        if (input.officerType === "secretary" || input.officerType === "designated_representative") {
```

And change the `update officers` query on lines 775-781 to filter by the same type
being appointed, not a hard-coded `'secretary'`:

```ts
          await tx`
            update officers
            set cessation_date = ${input.appointmentDate}, updated_at = now()
            where company_id = ${input.companyId}
              and officer_type = ${input.officerType}
              and cessation_date is null
          `;
```

Leave the `update companies set company_secretary = ...` block (lines 783-786)
unchanged but move it inside a narrower `if`, since DR has no denormalized column to
sync:

```ts
        if (input.officerType === "secretary" || input.officerType === "designated_representative") {
          await tx`select id from companies where id = ${input.companyId} for update`;

          await tx`
            update officers
            set cessation_date = ${input.appointmentDate}, updated_at = now()
            where company_id = ${input.companyId}
              and officer_type = ${input.officerType}
              and cessation_date is null
          `;

          if (input.officerType === "secretary") {
            await tx`
              update companies set company_secretary = ${input.name}, updated_at = now()
              where id = ${input.companyId}
            `;
          }
        }
```

- [ ] **Step 5: Add the significant-controller CRUD methods**

After `assertShareholdingBelongsToCompany`/`ceaseShareholding` (line 890-939), add:

```ts
  async function recordController(input: RecordControllerInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        await hydrateOrThrow(tx, input.companyId);

        await tx`
          insert into significant_controllers (
            company_id, controller_name, identification_type, identification_number,
            address, control_bases, registered_date, register_update_due_date
          ) values (
            ${input.companyId}, ${input.controllerName}, ${input.identificationType},
            ${input.identificationNumber}, ${input.address}, ${input.controlBases},
            ${input.registeredDate}, ${input.registerUpdateDueDate}
          )
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "controller_recorded",
          actorId: input.actorId,
          description: `Recorded significant controller ${input.controllerName}.`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function assertControllerBelongsToCompany(
    tx: TransactionSqlClient,
    companyId: string,
    controllerId: string,
  ): Promise<SignificantControllerRow> {
    const rows = await tx<SignificantControllerRow[]>`
      select id, company_id, controller_name, identification_type, identification_number,
             address, control_bases, registered_date, cessation_date, register_update_due_date
      from significant_controllers
      where id = ${controllerId} and company_id = ${companyId}
      limit 1
    `;

    const [row] = rows;

    if (!row) {
      throw new Error("Significant controller not found for this company.");
    }

    return row;
  }

  async function updateControllerParticulars(
    input: UpdateControllerParticularsInput,
  ): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        const controller = await assertControllerBelongsToCompany(
          tx,
          input.companyId,
          input.controllerId,
        );

        await tx`
          update significant_controllers
          set address = ${input.address},
              control_bases = ${input.controlBases},
              register_update_due_date = ${input.registerUpdateDueDate},
              updated_at = now()
          where id = ${input.controllerId} and company_id = ${input.companyId}
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "controller_updated",
          actorId: input.actorId,
          description: `Updated particulars for significant controller ${controller.controller_name}.`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function ceaseController(input: CeaseControllerInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        const controller = await assertControllerBelongsToCompany(
          tx,
          input.companyId,
          input.controllerId,
        );

        await tx`
          update significant_controllers
          set cessation_date = ${input.cessationDate}, updated_at = now()
          where id = ${input.controllerId} and company_id = ${input.companyId}
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "controller_ceased",
          actorId: input.actorId,
          description: `Ceased significant controller ${controller.controller_name}.`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function recordInspectionRequest(
    input: RecordInspectionRequestInput,
  ): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        await hydrateOrThrow(tx, input.companyId);

        await tx`
          insert into scr_inspection_requests (
            company_id, requester_name, requester_authority, request_date
          ) values (
            ${input.companyId}, ${input.requesterName}, ${input.requesterAuthority},
            ${input.requestDate}
          )
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "inspection_request_recorded",
          actorId: input.actorId,
          description: `Recorded inspection request from ${input.requesterName} (${input.requesterAuthority}).`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function assertInspectionRequestBelongsToCompany(
    tx: TransactionSqlClient,
    companyId: string,
    inspectionRequestId: string,
  ): Promise<InspectionRequestRow> {
    const rows = await tx<InspectionRequestRow[]>`
      select id, company_id, requester_name, requester_authority, request_date,
             resolution_note, resolved_at
      from scr_inspection_requests
      where id = ${inspectionRequestId} and company_id = ${companyId}
      limit 1
    `;

    const [row] = rows;

    if (!row) {
      throw new Error("Inspection request not found for this company.");
    }

    return row;
  }

  async function resolveInspectionRequest(
    input: ResolveInspectionRequestInput,
  ): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        const request = await assertInspectionRequestBelongsToCompany(
          tx,
          input.companyId,
          input.inspectionRequestId,
        );

        await tx`
          update scr_inspection_requests
          set resolution_note = ${input.resolutionNote}, resolved_at = now(), updated_at = now()
          where id = ${input.inspectionRequestId} and company_id = ${input.companyId}
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "inspection_request_resolved",
          actorId: input.actorId,
          description: `Resolved inspection request from ${request.requester_name}.`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }
```

- [ ] **Step 6: Register the new methods on `ClientRepository` and the returned object**

Add to the `ClientRepository` type (after `ceaseShareholding`, line 56):

```ts
  recordController(input: RecordControllerInput): Promise<ClientDetail>;
  updateControllerParticulars(input: UpdateControllerParticularsInput): Promise<ClientDetail>;
  ceaseController(input: CeaseControllerInput): Promise<ClientDetail>;
  recordInspectionRequest(input: RecordInspectionRequestInput): Promise<ClientDetail>;
  resolveInspectionRequest(input: ResolveInspectionRequestInput): Promise<ClientDetail>;
```

Add to the returned object (after `ceaseShareholding`, line 961):

```ts
    recordController,
    updateControllerParticulars,
    ceaseController,
    recordInspectionRequest,
    resolveInspectionRequest,
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: remaining errors only in `server-fns.ts` and UI components (not yet
updated) — repository.ts itself should be clean.

- [ ] **Step 8: Commit**

```bash
git add src/features/clients/repository.ts
git commit -m "feat: add significant-controller and inspection-request repository methods"
```

---

## Task 4: Repository integration tests + cleanup-fixture fix

**Files:**
- Modify: `src/features/clients/repository.test.ts`

**This task's cleanup-fixture update is not optional or deferrable** — see the design
spec's explicit callout: PR #46 merged with a failing CI "verify" job because a prior
task added a `company_id ... on delete restrict` table without updating this same
helper, and the fix needed its own follow-up PR (#47). Do it in this task, in the same
commit as the new tests.

- [ ] **Step 1: Update `cleanupClientFixtures` to clear the two new tables**

Current helper (lines 47-67):

```ts
async function cleanupClientFixtures() {
  if (!databaseUrl) return;

  const sql = sqlForTests();
  const companyIds = TEST_FIXTURE_SEQUENCES.map((sequence) =>
    testUuid(TEST_COMPANY_UUID_PREFIX, sequence),
  );
  const generatedCompanies = await sql<{ id: string }[]>`
    select id from companies where cr_number like 'TEST-CR-%'
  `;
  const allCompanyIds = [...companyIds, ...generatedCompanies.map((row) => row.id)];

  // officers/shareholdings reference companies with `on delete restrict`, so createClient's
  // auto-seeded secretary officer (and any shareholdings a test recorded) must be cleared
  // before the company row itself can be deleted.
  await sql`delete from officers where company_id = any(${allCompanyIds}::uuid[])`;
  await sql`delete from shareholdings where company_id = any(${allCompanyIds}::uuid[])`;

  // Companies cascade to contacts, cases, payments, and timeline events.
  await sql`delete from companies where id = any(${companyIds}::uuid[])`;
  // Companies created by createClient tests use generated ids, so match on the fixture prefix.
  await sql`delete from companies where cr_number like 'TEST-CR-%'`;

  ...
}
```

Add two more deletes alongside the `officers`/`shareholdings` ones:

```ts
  await sql`delete from officers where company_id = any(${allCompanyIds}::uuid[])`;
  await sql`delete from shareholdings where company_id = any(${allCompanyIds}::uuid[])`;
  await sql`delete from significant_controllers where company_id = any(${allCompanyIds}::uuid[])`;
  await sql`delete from scr_inspection_requests where company_id = any(${allCompanyIds}::uuid[])`;
```

- [ ] **Step 2: Add a `describe.skipIf(!databaseUrl)("significant controllers integration", ...)` block**

Add after the `"officers integration"` describe block closes (after line 956,
before `it("records and ceases a shareholding independently of officers", ...)`
— or as its own describe block placed after the whole `"officers integration"`
block ends). Mirror the existing officer test style exactly:

```ts
describe.skipIf(!databaseUrl)("significant controllers integration", () => {
  it("records, edits, and ceases a significant controller", async () => {
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
            companyName: "Controller Test Co Ltd",
            crNumber: `CR-SCR-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-SCR-${crypto.randomUUID().slice(0, 8)}`,
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

          expect(client.significantControllers).toEqual([]);

          const recorded = await repository.recordController({
            companyId: client.id,
            controllerName: "Jane Controller",
            identificationType: "hkid",
            identificationNumber: "A1234567",
            address: "4 Test Street, Hong Kong",
            controlBases: ["shares_over_25pct", "votes_over_25pct"],
            registeredDate: "2020-01-15",
            registerUpdateDueDate: null,
            actorId: owner.id,
          });

          const controller = recorded.significantControllers.find(
            (c) => c.controllerName === "Jane Controller",
          );
          expect(controller).toBeDefined();
          expect(controller?.controlBases).toEqual(["shares_over_25pct", "votes_over_25pct"]);
          expect(controller?.cessationDate).toBeNull();

          const edited = await repository.updateControllerParticulars({
            companyId: client.id,
            controllerId: controller!.id,
            address: "5 New Street, Hong Kong",
            controlBases: ["significant_influence"],
            registerUpdateDueDate: "2026-02-01",
            actorId: owner.id,
          });

          const editedController = edited.significantControllers.find(
            (c) => c.id === controller!.id,
          );
          expect(editedController?.address).toBe("5 New Street, Hong Kong");
          expect(editedController?.controlBases).toEqual(["significant_influence"]);
          expect(editedController?.registerUpdateDueDate).toBe("2026-02-01");

          const ceased = await repository.ceaseController({
            companyId: client.id,
            controllerId: controller!.id,
            cessationDate: "2026-06-01",
            actorId: owner.id,
          });

          expect(
            ceased.significantControllers.find((c) => c.id === controller!.id)?.cessationDate,
          ).toBe("2026-06-01");

          throw new Error("rollback significant controllers integration fixture");
        }),
      ).rejects.toThrow("rollback significant controllers integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("rejects an empty control_bases array", async () => {
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
            companyName: "Empty Basis Test Co Ltd",
            crNumber: `CR-SCR2-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-SCR2-${crypto.randomUUID().slice(0, 8)}`,
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

          await repository.recordController({
            companyId: client.id,
            controllerName: "Bad Controller",
            identificationType: null,
            identificationNumber: null,
            address: null,
            controlBases: [],
            registeredDate: "2020-01-15",
            registerUpdateDueDate: null,
            actorId: owner.id,
          });
        }),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });
});

describe.skipIf(!databaseUrl)("designated representative integration", () => {
  it("appointing a new DR cessates the old one without touching companies.company_secretary", async () => {
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
            companyName: "DR Test Co Ltd",
            crNumber: `CR-DR-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-DR-${crypto.randomUUID().slice(0, 8)}`,
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

          const firstDr = await repository.appointOfficer({
            companyId: client.id,
            officerType: "designated_representative",
            name: "First DR",
            identificationType: "hkid",
            identificationNumber: "B1234567",
            address: null,
            appointmentDate: "2020-02-01",
            actorId: owner.id,
          });

          expect(firstDr.companySecretary).toBe("A Secretary Ltd");
          expect(
            firstDr.officers.find((o) => o.name === "First DR")?.officerType,
          ).toBe("designated_representative");

          const secondDr = await repository.appointOfficer({
            companyId: client.id,
            officerType: "designated_representative",
            name: "Second DR",
            identificationType: "hkid",
            identificationNumber: "B7654321",
            address: null,
            appointmentDate: "2026-01-01",
            actorId: owner.id,
          });

          const first = secondDr.officers.find((o) => o.name === "First DR");
          const second = secondDr.officers.find((o) => o.name === "Second DR");

          expect(first?.cessationDate).toBe("2026-01-01");
          expect(second?.cessationDate).toBeNull();
          expect(secondDr.companySecretary).toBe("A Secretary Ltd");

          throw new Error("rollback DR integration fixture");
        }),
      ).rejects.toThrow("rollback DR integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("serializes concurrent DR appointments so exactly one ends up active", async () => {
    const setupSql = createSqlClient(databaseUrl!, { max: 1 });
    let companyId: string | undefined;

    try {
      const repository = createClientRepository({ sql: setupSql });
      const [owner] = await setupSql<{ id: string }[]>`
        select id from users where active limit 1
      `;
      const [team] = await setupSql<{ id: string }[]>`
        select id from teams where active limit 1
      `;

      const client = await repository.createClient({
        companyName: "DR Race Test Co Ltd",
        crNumber: `CR-DRRACE-${crypto.randomUUID().slice(0, 8)}`,
        brNumber: `BR-DRRACE-${crypto.randomUUID().slice(0, 8)}`,
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
      companyId = client.id;

      // Two independent connections racing to appoint a DR for the SAME company
      // concurrently — mirrors the secretary race test above, which is what
      // actually exercises the generalized `for update` lock in appointOfficer.
      const sqlA = createSqlClient(databaseUrl!, { max: 1 });
      const sqlB = createSqlClient(databaseUrl!, { max: 1 });

      try {
        await Promise.all([
          createClientRepository({ sql: sqlA }).appointOfficer({
            companyId: client.id,
            officerType: "designated_representative",
            name: "DR Candidate A",
            identificationType: null,
            identificationNumber: null,
            address: null,
            appointmentDate: "2026-01-01",
            actorId: owner.id,
          }),
          createClientRepository({ sql: sqlB }).appointOfficer({
            companyId: client.id,
            officerType: "designated_representative",
            name: "DR Candidate B",
            identificationType: null,
            identificationNumber: null,
            address: null,
            appointmentDate: "2026-01-01",
            actorId: owner.id,
          }),
        ]);
      } finally {
        await sqlA.end();
        await sqlB.end();
      }

      const final = await repository.getClient(client.id);
      const activeDrs = (final?.officers ?? []).filter(
        (o) => o.officerType === "designated_representative" && o.cessationDate === null,
      );

      expect(activeDrs).toHaveLength(1);
    } finally {
      if (companyId) {
        await setupSql`delete from officers where company_id = ${companyId}`;
        await setupSql`delete from companies where id = ${companyId}`;
      }
      await setupSql.end();
    }
  });
});

describe.skipIf(!databaseUrl)("inspection requests integration", () => {
  it("records and resolves an inspection request", async () => {
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
            companyName: "Inspection Test Co Ltd",
            crNumber: `CR-INSP-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-INSP-${crypto.randomUUID().slice(0, 8)}`,
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

          expect(client.inspectionRequests).toEqual([]);

          const recorded = await repository.recordInspectionRequest({
            companyId: client.id,
            requesterName: "Officer Lee",
            requesterAuthority: "Companies Registry",
            requestDate: "2026-01-15",
            actorId: owner.id,
          });

          const request = recorded.inspectionRequests.find((r) => r.requesterName === "Officer Lee");
          expect(request).toBeDefined();
          expect(request?.resolvedAt).toBeNull();

          const resolved = await repository.resolveInspectionRequest({
            companyId: client.id,
            inspectionRequestId: request!.id,
            resolutionNote: "Register shown to Officer Lee on site, 2026-01-16.",
            actorId: owner.id,
          });

          const resolvedRequest = resolved.inspectionRequests.find((r) => r.id === request!.id);
          expect(resolvedRequest?.resolutionNote).toBe(
            "Register shown to Officer Lee on site, 2026-01-16.",
          );
          expect(resolvedRequest?.resolvedAt).not.toBeNull();

          throw new Error("rollback inspection requests integration fixture");
        }),
      ).rejects.toThrow("rollback inspection requests integration fixture");
    } finally {
      await sql.end();
    }
  });
});
```

- [ ] **Step 3: Format and lint**

Run: `npx eslint --fix src/features/clients/repository.test.ts`
Expected: no remaining warnings.

- [ ] **Step 4: Commit**

```bash
git add src/features/clients/repository.test.ts
git commit -m "test: add significant-controller, DR, and inspection-request integration tests"
```

---

## Task 5: Server functions

**Files:**
- Modify: `src/features/clients/server-fns.ts`

- [ ] **Step 1: Widen `appointOfficerSchema`'s `officerType` enum**

Change line 120 from:

```ts
    officerType: z.enum(["director", "secretary"]),
```

to:

```ts
    officerType: z.enum(["director", "secretary", "designated_representative"]),
```

- [ ] **Step 2: Add the new Zod schemas**

After `ceaseShareholdingSchema` (line 150-154), add:

```ts
const controlBasisSchema = z.enum([
  "shares_over_25pct",
  "votes_over_25pct",
  "board_appointment_right",
  "significant_influence",
]);

const recordControllerSchema = z
  .object({
    companyId: z.string().uuid(),
    controllerName: z.string().min(1),
    identificationType: z.enum(["hkid", "passport", "br_number"]).nullable(),
    identificationNumber: z.string().nullable(),
    address: z.string().nullable(),
    controlBases: z.array(controlBasisSchema).min(1),
    registeredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    registerUpdateDueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .refine(
    (controller) =>
      (controller.identificationType === null) === (controller.identificationNumber === null),
    {
      message: "Provide both an identification type and number, or neither.",
      path: ["identificationNumber"],
    },
  );

const updateControllerParticularsSchema = z.object({
  companyId: z.string().uuid(),
  controllerId: z.string().uuid(),
  address: z.string().nullable(),
  controlBases: z.array(controlBasisSchema).min(1),
  registerUpdateDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

const ceaseControllerSchema = z.object({
  companyId: z.string().uuid(),
  controllerId: z.string().uuid(),
  cessationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const recordInspectionRequestSchema = z.object({
  companyId: z.string().uuid(),
  requesterName: z.string().min(1),
  requesterAuthority: z.string().min(1),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const resolveInspectionRequestSchema = z.object({
  companyId: z.string().uuid(),
  inspectionRequestId: z.string().uuid(),
  resolutionNote: z.string().min(1),
});
```

- [ ] **Step 3: Add the new server fns**

After `ceaseClientShareholding` (line 284-293), add:

```ts
export const recordClientController = createServerFn({ method: "POST" })
  .validator(recordControllerSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.recordController({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const updateClientControllerParticulars = createServerFn({ method: "POST" })
  .validator(updateControllerParticularsSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.updateControllerParticulars({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const ceaseClientController = createServerFn({ method: "POST" })
  .validator(ceaseControllerSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.ceaseController({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const recordClientInspectionRequest = createServerFn({ method: "POST" })
  .validator(recordInspectionRequestSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.recordInspectionRequest({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const resolveClientInspectionRequest = createServerFn({ method: "POST" })
  .validator(resolveInspectionRequestSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.resolveInspectionRequest({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: remaining errors only in UI components not yet updated (`officer-form-dialog.tsx`'s type selector doesn't yet offer DR — that's fine, it's still valid for the two existing types; the remaining errors should be in `production-client-detail.tsx`/its interaction test if anything, from the `ClientDetail` shape change in Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/features/clients/server-fns.ts
git commit -m "feat: add significant-controller and inspection-request server functions"
```

---

## Task 6: Officer dialog gets the DR option

**Files:**
- Modify: `src/components/clients/officer-form-dialog.tsx`

- [ ] **Step 1: Add the third `<option>`**

Change lines 116-119 from:

```tsx
              <option value="director">Director</option>
              <option value="secretary">Secretary</option>
```

to:

```tsx
              <option value="director">Director</option>
              <option value="secretary">Secretary</option>
              <option value="designated_representative">Designated Representative</option>
```

- [ ] **Step 2: Update the dialog description to also mention DR**

Change line 102 from:

```tsx
            Appointing a new secretary automatically supersedes the current one.
```

to:

```tsx
            Appointing a new secretary or Designated Representative automatically supersedes the
            current one of that type.
```

- [ ] **Step 3: Update the existing dialog test to cover the new option**

`officer-form-dialog.test.tsx` has two tests today (`"appoints a director with the
entered fields"` and `"shows an error and does not close when the server call
fails"`), both using the default `officerType` select value (`"director"`). Add a
third test after the first one (after line 51) that selects the new DR option:

```tsx
  it("appoints a Designated Representative when that type is selected", async () => {
    serverFns.appointClientOfficer.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <OfficerFormDialog open onOpenChange={() => {}} companyId="company-1" onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "designated_representative" },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane DR" } });
    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Appoint officer" }));

    await waitFor(() =>
      expect(serverFns.appointClientOfficer).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          officerType: "designated_representative",
          name: "Jane DR",
          identificationType: null,
          identificationNumber: null,
          address: null,
          appointmentDate: "2026-01-01",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run the dialog's tests**

Run: `npx vitest run src/components/clients/officer-form-dialog.test.tsx`
Expected: all pass, including the new DR case.

- [ ] **Step 5: Commit**

```bash
git add src/components/clients/officer-form-dialog.tsx src/components/clients/officer-form-dialog.test.tsx
git commit -m "feat: add Designated Representative as an officer type option"
```

---

## Task 7: Controller form dialog (add + edit)

**Files:**
- Create: `src/components/clients/controller-form-dialog.tsx`
- Create: `src/components/clients/controller-form-dialog.test.tsx`

This mirrors `contact-form-dialog.tsx`'s add-vs-edit pattern (an optional `controller`
prop) combined with `officer-form-dialog.tsx`'s HKT-safe `today()` local copy, plus a
checkbox group for `controlBases` (a multi-select array, decided in the design).

- [ ] **Step 1: Write the component**

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
import {
  recordClientController,
  updateClientControllerParticulars,
} from "@/features/clients/server-fns";
import type {
  ControlBasis,
  IdentificationType,
  SignificantController,
} from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Omit to record a new controller; supply to edit an existing one's particulars. */
  controller?: SignificantController;
  onSaved: () => void;
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Unable to derive ${type} from Hong Kong business date.`);
  }

  return part.value;
}

function today(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

const CONTROL_BASIS_OPTIONS: { value: ControlBasis; label: string }[] = [
  { value: "shares_over_25pct", label: "Holds more than 25% of shares" },
  { value: "votes_over_25pct", label: "Holds more than 25% of voting rights" },
  { value: "board_appointment_right", label: "Right to appoint/remove a majority of the board" },
  { value: "significant_influence", label: "Exercises significant influence or control" },
];

export function ControllerFormDialog({
  open,
  onOpenChange,
  companyId,
  controller,
  onSaved,
}: Props) {
  const [controllerName, setControllerName] = useState("");
  const [identificationType, setIdentificationType] = useState<IdentificationType | "">("");
  const [identificationNumber, setIdentificationNumber] = useState("");
  const [address, setAddress] = useState("");
  const [controlBases, setControlBases] = useState<ControlBasis[]>([]);
  const [registeredDate, setRegisteredDate] = useState(today());
  const [registerUpdateDueDate, setRegisterUpdateDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setControllerName(controller?.controllerName ?? "");
    setIdentificationType(controller?.identificationType ?? "");
    setIdentificationNumber(controller?.identificationNumber ?? "");
    setAddress(controller?.address ?? "");
    setControlBases(controller?.controlBases ?? []);
    setRegisteredDate(controller?.registeredDate ?? today());
    setRegisterUpdateDueDate(controller?.registerUpdateDueDate ?? "");
    setError(null);
  }, [open, controller]);

  function toggleBasis(basis: ControlBasis) {
    setControlBases((current) =>
      current.includes(basis) ? current.filter((value) => value !== basis) : [...current, basis],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (controlBases.length === 0) {
      setError("Select at least one control basis.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      if (controller) {
        await updateClientControllerParticulars({
          data: {
            companyId,
            controllerId: controller.id,
            address: address.trim() || null,
            controlBases,
            registerUpdateDueDate: registerUpdateDueDate || null,
          },
        });
      } else {
        await recordClientController({
          data: {
            companyId,
            controllerName,
            identificationType: identificationType || null,
            identificationNumber: identificationNumber.trim() || null,
            address: address.trim() || null,
            controlBases,
            registeredDate,
            registerUpdateDueDate: registerUpdateDueDate || null,
          },
        });
      }

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the controller.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{controller ? "Edit controller particulars" : "Record significant controller"}</DialogTitle>
          <DialogDescription>
            A controller must satisfy at least one of the four control tests.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {!controller ? (
            <div>
              <label className={labelClass} htmlFor="controller-form-name">
                Controller name
              </label>
              <input
                id="controller-form-name"
                className={inputClass}
                value={controllerName}
                onChange={(event) => setControllerName(event.target.value)}
                required
              />
            </div>
          ) : null}

          <div>
            <p className={labelClass}>Control bases</p>
            <div className="mt-1 space-y-1">
              {CONTROL_BASIS_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={controlBases.includes(option.value)}
                    onChange={() => toggleBasis(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          {!controller ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="controller-form-id-type">
                  Identification type
                </label>
                <select
                  id="controller-form-id-type"
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
                <label className={labelClass} htmlFor="controller-form-id-number">
                  Identification number
                </label>
                <input
                  id="controller-form-id-number"
                  className={inputClass}
                  value={identificationNumber}
                  onChange={(event) => setIdentificationNumber(event.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div>
            <label className={labelClass} htmlFor="controller-form-address">
              Address
            </label>
            <input
              id="controller-form-address"
              className={inputClass}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {!controller ? (
              <div>
                <label className={labelClass} htmlFor="controller-form-registered-date">
                  Registered date
                </label>
                <input
                  id="controller-form-registered-date"
                  type="date"
                  className={inputClass}
                  value={registeredDate}
                  onChange={(event) => setRegisteredDate(event.target.value)}
                  required
                />
              </div>
            ) : null}
            <div>
              <label className={labelClass} htmlFor="controller-form-due-date">
                Register update due date
              </label>
              <input
                id="controller-form-due-date"
                type="date"
                className={inputClass}
                value={registerUpdateDueDate}
                onChange={(event) => setRegisterUpdateDueDate(event.target.value)}
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
              {saving ? "Saving…" : controller ? "Save particulars" : "Record controller"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write the test file**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControllerFormDialog } from "./controller-form-dialog";
import type { SignificantController } from "@/features/clients/types";

const serverFns = vi.hoisted(() => ({
  recordClientController: vi.fn(),
  updateClientControllerParticulars: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  recordClientController: serverFns.recordClientController,
  updateClientControllerParticulars: serverFns.updateClientControllerParticulars,
}));

describe("ControllerFormDialog", () => {
  beforeEach(() => {
    serverFns.recordClientController.mockReset();
    serverFns.updateClientControllerParticulars.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("records a controller with the entered fields", async () => {
    serverFns.recordClientController.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <ControllerFormDialog open onOpenChange={() => {}} companyId="company-1" onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText("Controller name"), {
      target: { value: "Jane Controller" },
    });
    fireEvent.click(screen.getByLabelText("Holds more than 25% of shares"));
    fireEvent.change(screen.getByLabelText("Registered date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record controller" }));

    await waitFor(() =>
      expect(serverFns.recordClientController).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          controllerName: "Jane Controller",
          identificationType: null,
          identificationNumber: null,
          address: null,
          controlBases: ["shares_over_25pct"],
          registeredDate: "2026-01-01",
          registerUpdateDueDate: null,
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("rejects submitting with no control basis selected, without calling the server", async () => {
    render(
      <ControllerFormDialog open onOpenChange={() => {}} companyId="company-1" onSaved={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText("Controller name"), {
      target: { value: "Jane Controller" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record controller" }));

    expect(await screen.findByText("Select at least one control basis.")).toBeTruthy();
    expect(serverFns.recordClientController).not.toHaveBeenCalled();
  });

  it("edits an existing controller's particulars", async () => {
    serverFns.updateClientControllerParticulars.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();
    const controller: SignificantController = {
      id: "controller-1",
      companyId: "company-1",
      controllerName: "Jane Controller",
      identificationType: null,
      identificationNumber: null,
      address: "Old address",
      controlBases: ["shares_over_25pct"],
      registeredDate: "2020-01-15",
      cessationDate: null,
      registerUpdateDueDate: null,
    };

    render(
      <ControllerFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        controller={controller}
        onSaved={onSaved}
      />,
    );

    expect(screen.queryByLabelText("Controller name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "New address" } });
    fireEvent.click(screen.getByLabelText("Exercises significant influence or control"));
    fireEvent.click(screen.getByRole("button", { name: "Save particulars" }));

    await waitFor(() =>
      expect(serverFns.updateClientControllerParticulars).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          controllerId: "controller-1",
          address: "New address",
          controlBases: ["shares_over_25pct", "significant_influence"],
          registerUpdateDueDate: null,
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the new tests**

Run: `npx vitest run src/components/clients/controller-form-dialog.test.tsx`
Expected: all 3 pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/controller-form-dialog.tsx src/components/clients/controller-form-dialog.test.tsx
git commit -m "feat: add ControllerFormDialog for recording and editing significant controllers"
```

---

## Task 8: Inspection request dialogs (record + resolve)

**Files:**
- Create: `src/components/clients/inspection-request-form-dialog.tsx`
- Create: `src/components/clients/inspection-request-form-dialog.test.tsx`
- Create: `src/components/clients/resolve-inspection-request-dialog.tsx`
- Create: `src/components/clients/resolve-inspection-request-dialog.test.tsx`

- [ ] **Step 1: Write the record dialog**

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
import { recordClientInspectionRequest } from "@/features/clients/server-fns";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onSaved: () => void;
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Unable to derive ${type} from Hong Kong business date.`);
  }

  return part.value;
}

function today(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

export function InspectionRequestFormDialog({ open, onOpenChange, companyId, onSaved }: Props) {
  const [requesterName, setRequesterName] = useState("");
  const [requesterAuthority, setRequesterAuthority] = useState("");
  const [requestDate, setRequestDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setRequesterName("");
    setRequesterAuthority("");
    setRequestDate(today());
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      await recordClientInspectionRequest({
        data: { companyId, requesterName, requesterAuthority, requestDate },
      });

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record inspection request</DialogTitle>
          <DialogDescription>
            Log a request to inspect this company's significant controllers register.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="inspection-form-requester">
              Requester name
            </label>
            <input
              id="inspection-form-requester"
              className={inputClass}
              value={requesterName}
              onChange={(event) => setRequesterName(event.target.value)}
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="inspection-form-authority">
              Requester authority
            </label>
            <input
              id="inspection-form-authority"
              className={inputClass}
              value={requesterAuthority}
              onChange={(event) => setRequesterAuthority(event.target.value)}
              placeholder="e.g. Companies Registry"
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="inspection-form-date">
              Request date
            </label>
            <input
              id="inspection-form-date"
              type="date"
              className={inputClass}
              value={requestDate}
              onChange={(event) => setRequestDate(event.target.value)}
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
              {saving ? "Saving…" : "Record request"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write the record dialog's test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectionRequestFormDialog } from "./inspection-request-form-dialog";

const serverFns = vi.hoisted(() => ({
  recordClientInspectionRequest: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  recordClientInspectionRequest: serverFns.recordClientInspectionRequest,
}));

describe("InspectionRequestFormDialog", () => {
  beforeEach(() => {
    serverFns.recordClientInspectionRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("records an inspection request with the entered fields", async () => {
    serverFns.recordClientInspectionRequest.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <InspectionRequestFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Requester name"), {
      target: { value: "Officer Lee" },
    });
    fireEvent.change(screen.getByLabelText("Requester authority"), {
      target: { value: "Companies Registry" },
    });
    fireEvent.change(screen.getByLabelText("Request date"), {
      target: { value: "2026-01-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));

    await waitFor(() =>
      expect(serverFns.recordClientInspectionRequest).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          requesterName: "Officer Lee",
          requesterAuthority: "Companies Registry",
          requestDate: "2026-01-15",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.recordClientInspectionRequest.mockRejectedValue(new Error("Client not found."));

    render(
      <InspectionRequestFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Requester name"), {
      target: { value: "Officer Lee" },
    });
    fireEvent.change(screen.getByLabelText("Requester authority"), {
      target: { value: "Companies Registry" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));

    expect(await screen.findByText("Client not found.")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Write the resolve dialog**

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
import { resolveClientInspectionRequest } from "@/features/clients/server-fns";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  inspectionRequestId: string;
  onSaved: () => void;
};

const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function ResolveInspectionRequestDialog({
  open,
  onOpenChange,
  companyId,
  inspectionRequestId,
  onSaved,
}: Props) {
  const [resolutionNote, setResolutionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setResolutionNote("");
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      await resolveClientInspectionRequest({
        data: { companyId, inspectionRequestId, resolutionNote },
      });

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to resolve the request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve inspection request</DialogTitle>
          <DialogDescription>Record how and when the request was fulfilled.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="resolve-inspection-note">
              Resolution note
            </label>
            <textarea
              id="resolve-inspection-note"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
              rows={3}
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
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
              {saving ? "Saving…" : "Resolve"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write the resolve dialog's test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResolveInspectionRequestDialog } from "./resolve-inspection-request-dialog";

const serverFns = vi.hoisted(() => ({
  resolveClientInspectionRequest: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  resolveClientInspectionRequest: serverFns.resolveClientInspectionRequest,
}));

describe("ResolveInspectionRequestDialog", () => {
  beforeEach(() => {
    serverFns.resolveClientInspectionRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("resolves the request with the entered note", async () => {
    serverFns.resolveClientInspectionRequest.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <ResolveInspectionRequestDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        inspectionRequestId="request-1"
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Shown to Officer Lee on site." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() =>
      expect(serverFns.resolveClientInspectionRequest).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          inspectionRequestId: "request-1",
          resolutionNote: "Shown to Officer Lee on site.",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run src/components/clients/inspection-request-form-dialog.test.tsx src/components/clients/resolve-inspection-request-dialog.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/clients/inspection-request-form-dialog.tsx src/components/clients/inspection-request-form-dialog.test.tsx src/components/clients/resolve-inspection-request-dialog.tsx src/components/clients/resolve-inspection-request-dialog.test.tsx
git commit -m "feat: add inspection request record and resolve dialogs"
```

---

## Task 9: Wire the two new sections into the client detail page

**Files:**
- Modify: `src/features/clients/components/production-client-detail.tsx`

- [ ] **Step 1: Add imports**

Add after the `ShareholdingFormDialog` import (line 13):

```tsx
import { ControllerFormDialog } from "@/components/clients/controller-form-dialog";
import { InspectionRequestFormDialog } from "@/components/clients/inspection-request-form-dialog";
import { ResolveInspectionRequestDialog } from "@/components/clients/resolve-inspection-request-dialog";
import { DeadlinePill } from "@/components/deadline-pill";
```

Add to the named imports from `../server-fns` (line 14-20):

```tsx
import {
  ceaseClientController,
  ceaseClientOfficer,
  ceaseClientShareholding,
  getClient,
  listClientAssignmentOptions,
  removeClientContact,
} from "../server-fns";
```

Add to the type import from `../types` (line 21):

```tsx
import type {
  ClientPaymentStatus,
  CompanyContact,
  CompanyStatus,
  SignificantController,
} from "../types";
```

- [ ] **Step 2: Widen `officerTypeLabel`**

Change lines 41-44 from:

```tsx
const officerTypeLabel: Record<"director" | "secretary", string> = {
  director: "Director",
  secretary: "Secretary",
};
```

to:

```tsx
const officerTypeLabel: Record<"director" | "secretary" | "designated_representative", string> = {
  director: "Director",
  secretary: "Secretary",
  designated_representative: "Designated Representative",
};
```

- [ ] **Step 3: Add state and handlers**

Add to the state declarations (after `ceasingShareholdingId`, line 79):

```tsx
  const [controllerDialog, setControllerDialog] = useState<{
    open: boolean;
    controller?: SignificantController;
  }>({ open: false });
  const [ceasingControllerId, setCeasingControllerId] = useState<string | null>(null);
  const [isInspectionDialogOpen, setIsInspectionDialogOpen] = useState(false);
  const [resolvingInspectionRequestId, setResolvingInspectionRequestId] = useState<string | null>(
    null,
  );
```

Add a handler after `handleCeaseShareholding` (line 130-147):

```tsx
  async function handleCeaseController(controllerId: string) {
    setCeasingControllerId(controllerId);

    try {
      await ceaseClientController({
        data: {
          companyId: clientId,
          controllerId,
          cessationDate: today(),
        },
      });
      invalidate();
    } catch {
      toast.error("Unable to cease the controller. Try again.");
    } finally {
      setCeasingControllerId(null);
    }
  }
```

- [ ] **Step 4: Add the Significant Controllers section**

Insert after the Shareholders `</section>` (after line 329, before the Contacts
section):

```tsx
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Significant controllers</h2>
          <button
            type="button"
            onClick={() => setControllerDialog({ open: true })}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Record controller
          </button>
        </div>
        <div className="divide-y">
          {client.significantControllers.map((controller) => (
            <div key={controller.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{controller.controllerName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Registered {controller.registeredDate}
                  {controller.cessationDate ? ` · Ceased ${controller.cessationDate}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {controller.controlBases.map((basis) => (
                    <span
                      key={basis}
                      className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground"
                    >
                      {basis.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {controller.registerUpdateDueDate ? (
                  <DeadlinePill dueDate={controller.registerUpdateDueDate} />
                ) : null}
                <StatusPill tone={controller.cessationDate ? "neutral" : "green"}>
                  {controller.cessationDate ? "Ceased" : "Active"}
                </StatusPill>
                {!controller.cessationDate ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setControllerDialog({ open: true, controller })}
                      className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Edit particulars
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCeaseController(controller.id)}
                      disabled={ceasingControllerId === controller.id}
                      className="rounded-md border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                    >
                      Cease
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
          {client.significantControllers.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No significant controllers on file.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Inspection requests</h2>
          <button
            type="button"
            onClick={() => setIsInspectionDialogOpen(true)}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Record request
          </button>
        </div>
        <div className="divide-y">
          {client.inspectionRequests.map((request) => (
            <div key={request.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{request.requesterName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {request.requesterAuthority} · Requested {request.requestDate}
                  {request.resolutionNote ? ` · ${request.resolutionNote}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={request.resolvedAt ? "green" : "yellow"}>
                  {request.resolvedAt ? "Resolved" : "Pending"}
                </StatusPill>
                {!request.resolvedAt ? (
                  <button
                    type="button"
                    onClick={() => setResolvingInspectionRequestId(request.id)}
                    className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    Resolve
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {client.inspectionRequests.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No inspection requests on file.</p>
          ) : null}
        </div>
      </section>
```

- [ ] **Step 5: Render the new dialogs**

Add after the `<ShareholdingFormDialog ... />` block (after line 482, before the
closing `</main>`):

```tsx
      <ControllerFormDialog
        open={controllerDialog.open}
        onOpenChange={(open) => setControllerDialog((current) => ({ ...current, open }))}
        companyId={clientId}
        controller={controllerDialog.controller}
        onSaved={() => {
          invalidate();
          setControllerDialog({ open: false });
        }}
      />

      <InspectionRequestFormDialog
        open={isInspectionDialogOpen}
        onOpenChange={setIsInspectionDialogOpen}
        companyId={clientId}
        onSaved={invalidate}
      />

      {resolvingInspectionRequestId ? (
        <ResolveInspectionRequestDialog
          open
          onOpenChange={(open) => {
            if (!open) setResolvingInspectionRequestId(null);
          }}
          companyId={clientId}
          inspectionRequestId={resolvingInspectionRequestId}
          onSaved={() => {
            invalidate();
            setResolvingInspectionRequestId(null);
          }}
        />
      ) : null}
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/clients/components/production-client-detail.tsx
git commit -m "feat: add significant controllers and inspection requests sections to client detail"
```

---

## Task 10: Update the client-detail interaction test

**Files:**
- Modify: `src/features/clients/components/production-client-detail.interaction.test.tsx`

- [ ] **Step 1: Add the new server-fn mocks**

Change the `vi.hoisted` block (lines 12-18) to:

```tsx
const serverFns = vi.hoisted(() => ({
  getClient: vi.fn(),
  listClientAssignmentOptions: vi.fn(),
  removeClientContact: vi.fn(),
  ceaseClientOfficer: vi.fn(),
  ceaseClientShareholding: vi.fn(),
  ceaseClientController: vi.fn(),
}));
```

Update the `vi.mock("../server-fns", ...)` call (lines 20-26) to include the new
export:

```tsx
vi.mock("../server-fns", () => ({
  getClient: serverFns.getClient,
  listClientAssignmentOptions: serverFns.listClientAssignmentOptions,
  removeClientContact: serverFns.removeClientContact,
  ceaseClientOfficer: serverFns.ceaseClientOfficer,
  ceaseClientShareholding: serverFns.ceaseClientShareholding,
  ceaseClientController: serverFns.ceaseClientController,
}));
```

- [ ] **Step 2: Add fixture defaults**

Add `significantControllers: []` and `inspectionRequests: []` to `makeClient`'s
returned object (after `shareholdings: []`, line 62):

```tsx
    officers: [],
    shareholdings: [],
    significantControllers: [],
    inspectionRequests: [],
```

Add the corresponding `mockReset()` call in `beforeEach` (after
`serverFns.ceaseClientShareholding.mockReset();`, line 97):

```tsx
    serverFns.ceaseClientController.mockReset();
```

- [ ] **Step 3: Add a new test for the two new sections**

Add after the existing `"renders officers and shareholdings, and ceases an officer on
click"` test (after line 270, before the closing `});` of the `describe` block):

```tsx
  it("renders significant controllers and inspection requests, and ceases a controller on click", async () => {
    serverFns.getClient.mockResolvedValue(
      makeClient({
        significantControllers: [
          {
            id: "controller-1",
            companyId: clientId,
            controllerName: "Jane Controller",
            identificationType: null,
            identificationNumber: null,
            address: null,
            controlBases: ["shares_over_25pct"],
            registeredDate: "2020-01-15",
            cessationDate: null,
            registerUpdateDueDate: null,
          },
        ],
        inspectionRequests: [
          {
            id: "request-1",
            companyId: clientId,
            requesterName: "Officer Lee",
            requesterAuthority: "Companies Registry",
            requestDate: "2026-01-15",
            resolutionNote: null,
            resolvedAt: null,
          },
        ],
      }),
    );
    serverFns.ceaseClientController.mockResolvedValue({});
    renderDetail();

    await screen.findByText("Jane Controller");
    expect(screen.getByText("Officer Lee")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cease" }));

    await waitFor(() =>
      expect(serverFns.ceaseClientController).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: clientId, controllerId: "controller-1" }),
      }),
    );
  });
```

- [ ] **Step 4: Run the interaction test**

Run: `npx vitest run src/features/clients/components/production-client-detail.interaction.test.tsx`
Expected: all pass, including the new test.

- [ ] **Step 5: Commit**

```bash
git add src/features/clients/components/production-client-detail.interaction.test.tsx
git commit -m "test: cover significant controllers and inspection requests on the client detail page"
```

---

## Task 11: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the repo.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: no new errors (pre-existing warnings, e.g. `work-queue.tsx`'s fast-refresh
warning, are unrelated and may remain).

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all non-DB tests pass; DB-integration tests skip locally
(`TEST_DATABASE_URL` unset in this sandbox) — this is expected, not a gap, per
CLAUDE.md's testing conventions.

- [ ] **Step 4: Offline pre-deploy gate**

Run: `npm run verify:firm -- --dry-run`
Expected: passes, including the `migration-schema` consistency check for migration
0016.

- [ ] **Step 5: Manual smoke test in demo mode**

Start the dev server and confirm `/clients` still renders its explanatory
"no demo data" notice with no crash (this feature has no fixture-backed demo tier —
production-mode UI for significant controllers/DR/inspection requests cannot be
exercised in this sandbox due to the pre-existing `NEON_AUTH_URL is required`
limitation documented in earlier roadmap work; disclose this rather than claiming a
full production-mode smoke test).

- [ ] **Step 6: Dispatch a final holistic code review of the whole branch diff**

Compare the full diff against `docs/superpowers/specs/2026-08-22-scr-designated-representative-design.md` for spec compliance, and do an adversarial sweep specifically for raw-SQL references to `officer_type`'s old two-value assumption or the new tables' column names outside `repository.ts`/`repository.test.ts` (mirroring the lesson from [[feedback_schema_migration_raw_sql_sweep]]) before considering the branch ready.

- [ ] **Step 7: Confirm CI is green in an actual CI run before merging**

This is the same class of check that PR #46 skipped and PR #47 had to fix
retroactively — after pushing and opening the PR, wait for the `verify` CI job
(which runs the DB-integration suite against a real database) to report `SUCCESS`
before treating this item as done, not just a local green `npm test`.

---

## Self-Review Notes

- **Spec coverage**: Schema (Task 1), repository/server-fns (Tasks 3, 5), DR as a
  third officer type (Tasks 1, 3, 6), UI (Tasks 7-9), testing including the
  cleanup-fixture fix and a correctly-shaped concurrency test from the start (Tasks 4,
  10), and the explicit "confirm CI green before merging" acceptance criterion
  (Task 11) all have a task. No gaps found against the design spec's four sections.
- **Placeholder scan**: no TBD/TODO; every step has real code.
- **Type consistency**: `ControlBasis`, `SignificantController`, `InspectionRequest`,
  and the five new input types are defined once in Task 2 and referenced identically
  (same field names) in Tasks 3, 5, 7, 8, 9, 10 — checked for drift across all tasks.
