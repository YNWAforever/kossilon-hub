// Parent-only SQL correctness test on an externally verified disposable target.
// No dotenv, module-scope client, storage/scanner calls, seed copying or deletes.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createBulkOperationsRepository } from "@/features/bulk-operations/repository";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { readTupleCursor } from "@/server/db/pagination";
import { guardSqlTestLifetime } from "@/test/sql-test-lifetime";
import type { DocumentSearchFilters } from "./list-filters";
import { createDocumentRepository } from "./repository";
import { listDocumentPageForActor } from "./server-fns";

const databaseUrl = process.env.TEST_DATABASE_URL;
type Review = "pending" | "verified" | "rejected";
type FixtureDocument = {
  id: string;
  company_id: string;
  file_type: "payment" | "identity" | "registry" | "other";
  file_name: string;
  storage_url: string;
  upload_source: "client" | "staff" | "system";
  verification_status: Review;
  effective_review_status: Review;
  uploaded_at: string;
  current_version_id: string | null;
  prior_version_id: string | null;
  reviewed_document_version_id: string | null;
  intent_id: string | null;
};
type ScenarioEvidence = {
  name: string;
  actorUserId: string;
  filters: DocumentSearchFilters;
  limit: number;
  expectedIds: string[];
  pageSizes: number[];
  pagedIds: string[];
  cursorTimestamps: string[];
  snapshotId: string | null;
  snapshotCount: number | null;
  snapshotIds: string[];
};

describe.skipIf(!databaseUrl)("R17 owned 1000-document SQL register correctness", () => {
  it("matches bounded filename/category/source/current-review pages to exact snapshots, denies other teams, and rolls back every owned ID", async ({
    signal,
  }) => {
    const runId = `r17-doc-volume-${randomUUID()}`;
    const teams = [randomUUID(), randomUUID()];
    const users = [randomUUID(), randomUUID()];
    const profiles = [randomUUID(), randomUUID()];
    const companies = [randomUUID(), randomUUID()];
    const companyNames = [`${runId} Owned Alpha`, `${runId} Owned Beta`];
    const actors: AuthenticatedActor[] = users.map((userId, index) => ({
      authUserId: `${runId}-auth-${index}`,
      userId,
      teamId: teams[index],
      role: "Manager",
      active: true,
    }));
    const filenameNeedle = `${runId}-中文_50%_report`;
    const categories = ["payment", "identity", "registry", "other"] as const;
    const sources = ["client", "staff", "system"] as const;
    // Exactly 1000 Team A documents plus ten matching wrong-team controls.
    // A has 200 metadata-only, 800 current versions and 200 superseded versions.
    const documents: FixtureDocument[] = Array.from({ length: 1010 }, (_, index) => {
      const id = randomUUID();
      const mode = index % 5;
      const current = mode === 0 ? null : randomUUID();
      const prior = mode === 4 ? randomUUID() : null;
      return {
        id,
        company_id: companies[index < 1000 ? 0 : 1],
        file_type: categories[index % categories.length],
        file_name: `${runId}-${index % 7 < 3 ? "中文_50%_report" : "archive"}-${String(index).padStart(4, "0")}.pdf`,
        storage_url: `synthetic/${runId}/${id}/current.pdf`,
        upload_source: sources[index % sources.length],
        verification_status: mode === 3 ? "rejected" : mode === 1 ? "pending" : "verified",
        effective_review_status: mode === 2 ? "verified" : mode === 3 ? "rejected" : "pending",
        uploaded_at:
          index < 400 || index >= 1000
            ? "2000-01-01T00:00:00.123456Z"
            : index < 800
              ? "2000-01-01T00:00:00.123455Z"
              : "2000-01-01T00:00:00.123454Z",
        current_version_id: current,
        prior_version_id: prior,
        reviewed_document_version_id: mode === 2 || mode === 3 ? current : prior,
        intent_id: current ? randomUUID() : null,
      };
    });
    const versioned = documents.filter((row) => row.current_version_id !== null);
    const versions = versioned.flatMap((row) => [
      {
        id: row.current_version_id!,
        document_id: row.id,
        version_number: row.prior_version_id ? 2 : 1,
        file_name: row.file_name,
        storage_url: row.storage_url,
        intent_id: row.intent_id,
        superseded_by_version_id: null,
        superseded_at: null,
      },
      ...(row.prior_version_id
        ? [
            {
              id: row.prior_version_id,
              document_id: row.id,
              version_number: 1,
              file_name: `${runId}-prior.pdf`,
              storage_url: `synthetic/${runId}/${row.id}/prior.pdf`,
              intent_id: null,
              superseded_by_version_id: row.current_version_id,
              superseded_at: row.uploaded_at,
            },
          ]
        : []),
    ]);
    const ownedIds = {
      teams,
      users,
      profiles,
      companies,
      documents: documents.map((row) => row.id),
      intents: versioned.map((row) => row.intent_id!),
      versions: versions.map((row) => row.id),
      snapshots: [] as string[], // Exact IDs returned by the actual snapshot repository.
    };
    const createdIds: Record<keyof typeof ownedIds, string[]> = {
      teams: [],
      users: [],
      profiles: [],
      companies: [],
      documents: [],
      intents: [],
      versions: [],
      snapshots: [],
    };
    const observed = {
      precision: null as null | {
        checkedCount: number;
        mismatchIds: string[];
        samples: { id: string; expected: string; stored: string }[];
      },
      scenarios: [] as ScenarioEvidence[],
      wrongTeamCompanyDenied: false,
      noTeamDenied: false,
    };
    const rollback = new Error(`${runId}: intentional rollback`);
    let failure: unknown;
    const evidenceDir = process.env.COSEC_EVIDENCE_DIR;
    async function receipt(phase: string, remaining?: { resource: string; id: string }[]) {
      const record = {
        runId,
        phase,
        scope: "SQL correctness only; no p95, native Auth, storage or scanner evidence",
        ownedIds,
        createdIds,
        observed,
        rollbackVerified: remaining === undefined ? null : remaining.length === 0,
        remainingExactIds: remaining ?? null,
      };
      if (evidenceDir) {
        await mkdir(evidenceDir, { recursive: true });
        await writeFile(
          join(evidenceDir, `R17-document-volume-${runId}.json`),
          JSON.stringify(record, null, 2) + "\n",
        );
      } else if (phase === "allocated-before-client" || remaining !== undefined) {
        console.info("R17_DOCUMENT_VOLUME_FIXTURE", JSON.stringify(record));
      }
    }
    await receipt("allocated-before-client");
    // Instantiated only by the parent's explicitly executed, identity-gated test.
    const raw = createSqlClient(databaseUrl!, { max: 1 });
    const sql = guardSqlTestLifetime(raw, () => signal);
    try {
      await sql.begin(async (transaction) => {
        const tx = transaction as unknown as SqlClient;
        await tx`set local statement_timeout = '15s'`;
        await tx`set local lock_timeout = '3s'`;
        await tx`set local timezone = 'UTC'`;
        await tx`insert into teams(id,name,active) values
          (${teams[0]},${runId + " Team A"},true),(${teams[1]},${runId + " Team B"},true)`;
        createdIds.teams.push(...teams);
        await tx`insert into users(id,name,email,role,team_id,active) values
          (${users[0]},${runId + " Manager A"},${runId + "-a@example.invalid"},'Manager',${teams[0]},true),
          (${users[1]},${runId + " Manager B"},${runId + "-b@example.invalid"},'Manager',${teams[1]},true)`;
        createdIds.users.push(...users);
        await tx`insert into staff_profiles(id,user_id,auth_user_id,role,team_id,active) values
          (${profiles[0]},${users[0]},${actors[0].authUserId},'Manager',${teams[0]},true),
          (${profiles[1]},${users[1]},${actors[1].authUserId},'Manager',${teams[1]},true)`;
        createdIds.profiles.push(...profiles);
        await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,
          annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id,data_origin)
          values (${companies[0]},${companyNames[0]},${runId + "-cr-a"},${runId + "-br-a"},'2020-01-01',
            '2026-01-01','Synthetic office','Synthetic secretary','active',${users[0]},${teams[0]},'client'),
          (${companies[1]},${companyNames[1]},${runId + "-cr-b"},${runId + "-br-b"},'2020-01-01',
            '2026-01-01','Synthetic office','Synthetic secretary','active',${users[1]},${teams[1]},'client')`;
        createdIds.companies.push(...companies);
        // JSON text staging preserves all six timestamp digits before SQL casts.
        await tx`insert into documents(id,company_id,file_type,file_name,storage_url,upload_source,verification_status,uploaded_at)
          select f.id,f.company_id,f.file_type,f.file_name,f.storage_url,f.upload_source,f.verification_status,f.uploaded_at::timestamptz
          from jsonb_to_recordset(${tx.json(documents)}::jsonb) f(id uuid,company_id uuid,file_type text,file_name text,
            storage_url text,upload_source text,verification_status text,uploaded_at text)`;
        createdIds.documents.push(...ownedIds.documents);
        await tx`insert into document_upload_intents(id,company_id,document_id,requested_by_auth_user_id,category,
          file_name,content_type,expected_size_bytes,checksum_sha256,object_key,status,expires_at)
          select f.intent_id,f.company_id,f.id,${runId},f.file_type,f.file_name,'application/pdf',20,
            ${"a".repeat(64)},f.storage_url,'quarantined','2099-01-01'::timestamptz
          from jsonb_to_recordset(${tx.json(versioned)}::jsonb) f(intent_id uuid,company_id uuid,id uuid,
            file_type text,file_name text,storage_url text)`;
        createdIds.intents.push(...ownedIds.intents);
        // Superseded rows already point at their current version; no temporary
        // duplicate-current state or broad fixture mutation is required.
        await tx`insert into document_versions(id,document_id,version_number,file_name,storage_url,intent_id,
          superseded_by_version_id,superseded_at)
          select f.id,f.document_id,f.version_number,f.file_name,f.storage_url,f.intent_id,
            f.superseded_by_version_id,f.superseded_at::timestamptz
          from jsonb_to_recordset(${tx.json(versions)}::jsonb) f(id uuid,document_id uuid,version_number integer,
            file_name text,storage_url text,intent_id uuid,superseded_by_version_id uuid,superseded_at text)`;
        createdIds.versions.push(...ownedIds.versions);
        // The review FK is populated only after its exact version IDs exist.
        await tx`update documents d set reviewed_document_version_id=f.reviewed_document_version_id
          from jsonb_to_recordset(${tx.json(documents)}::jsonb) f(id uuid,reviewed_document_version_id uuid)
          where d.id=f.id`;
        const precision = await tx<
          { id: string; expected: string; stored: string; exact: boolean }[]
        >`select d.id::text,f.uploaded_at expected,d.uploaded_at::text stored,
            d.uploaded_at=f.uploaded_at::timestamptz exact
          from documents d join jsonb_to_recordset(${tx.json(documents)}::jsonb)
            f(id uuid,uploaded_at text) on f.id=d.id order by d.id`;
        const sampleIds = new Set<string>([
          documents[0].id,
          documents[399].id,
          documents[400].id,
          documents[799].id,
          documents[800].id,
          documents[999].id,
        ]);
        observed.precision = {
          checkedCount: precision.length,
          mismatchIds: precision.filter((row) => !row.exact).map((row) => row.id),
          samples: precision.filter((row) => sampleIds.has(row.id)),
        };
        await receipt("fixture-inserted-precision-checked");
        expect(precision.map((row) => row.id)).toEqual([...ownedIds.documents].sort());
        expect(observed.precision.mismatchIds).toEqual([]);

        const repository = createDocumentRepository({ sql: tx });
        const bulk = createBulkOperationsRepository({ sql: tx });
        const dependencies = {
          repository,
          authorizeDocument: async () => {
            throw new Error("Unexpected by-ID authorization in staff list read");
          },
        };
        const byId = new Map(documents.map((row) => [row.id, row]));
        const own = documents.slice(0, 1000);
        const other = documents.slice(1000);
        async function checkScenario(
          name: string,
          filters: DocumentSearchFilters,
          matches: FixtureDocument[],
          actor = actors[0],
          limit = 37,
        ) {
          const expected = [...matches].sort((left, right) =>
            left.uploaded_at !== right.uploaded_at
              ? left.uploaded_at > right.uploaded_at
                ? -1
                : 1
              : left.id < right.id
                ? -1
                : left.id > right.id
                  ? 1
                  : 0,
          );
          const evidence: ScenarioEvidence = {
            name,
            actorUserId: actor.userId!,
            filters,
            limit,
            expectedIds: expected.map((row) => row.id),
            pageSizes: [],
            pagedIds: [],
            cursorTimestamps: [],
            snapshotId: null,
            snapshotCount: null,
            snapshotIds: [],
          };
          observed.scenarios.push(evidence);
          let cursor: string | undefined;
          const seenCursors = new Set<string>();
          do {
            signal.throwIfAborted();
            const offset = evidence.pagedIds.length;
            const page = await listDocumentPageForActor(
              actor,
              { ...filters, cursor, limit },
              dependencies,
            );
            evidence.pageSizes.push(page.documents.length);
            evidence.pagedIds.push(...page.documents.map((row) => row.id));
            expect(page.documents.length).toBeLessThanOrEqual(limit);
            expect(evidence.pageSizes.length).toBeLessThanOrEqual(
              Math.max(1, Math.ceil(expected.length / limit)),
            );
            expect(page.documents.map((row) => row.id)).toEqual(
              evidence.expectedIds.slice(offset, offset + limit),
            );
            for (const row of page.documents) {
              const model = byId.get(row.id)!;
              expect(row).toMatchObject({
                companyId: model.company_id,
                category: model.file_type,
                fileName: model.file_name,
                uploadSource: model.upload_source,
                currentVersionId: model.current_version_id,
                reviewedVersionId: model.reviewed_document_version_id,
                intentId: model.intent_id,
                reviewStatus: model.effective_review_status,
                availability: model.current_version_id ? "quarantined" : "metadata_only",
                objectAvailability: "not_checked",
              });
            }
            expect(Boolean(page.nextCursor)).toBe(evidence.pagedIds.length < expected.length);
            if (page.nextCursor) {
              expect(seenCursors.has(page.nextCursor)).toBe(false);
              seenCursors.add(page.nextCursor);
              const tuple = readTupleCursor(page.nextCursor, 2)!;
              const boundary = byId.get(page.documents.at(-1)!.id)!;
              expect(tuple).toEqual([
                boundary.uploaded_at.replace("T", " ").replace("Z", "+00"),
                boundary.id,
              ]);
              evidence.cursorTimestamps.push(tuple[0]);
            }
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          expect(evidence.pagedIds).toEqual(evidence.expectedIds);
          expect(new Set(evidence.pagedIds).size).toBe(expected.length);

          const snapshot = await bulk.createSnapshot(actor, { resource: "document", filters });
          ownedIds.snapshots.push(snapshot.snapshotId);
          createdIds.snapshots.push(snapshot.snapshotId);
          evidence.snapshotId = snapshot.snapshotId;
          evidence.snapshotCount = snapshot.count;
          const [saved] = await tx<
            { items: { id: string }[] }[]
          >`select items from bulk_selection_snapshots where id=${snapshot.snapshotId}::uuid`;
          evidence.snapshotIds = saved.items.map((row) => row.id);
          await receipt(`scenario-${name}-read`);
          expect(snapshot.count).toBe(expected.length);
          expect(saved.items).toHaveLength(expected.length);
          expect([...evidence.snapshotIds].sort()).toEqual([...evidence.expectedIds].sort());
          expect([...evidence.snapshotIds].sort()).toEqual([...evidence.pagedIds].sort());
          return evidence;
        }
        const all = await checkScenario("all-1000", { q: runId }, own);
        expect(all.pageSizes).toEqual([...Array<number>(27).fill(37), 1]);
        expect(own.filter((row) => row.current_version_id)).toHaveLength(800);
        expect(own.filter((row) => row.prior_version_id)).toHaveLength(200);
        const filenameMatches = own.filter((row) => row.file_name.includes(filenameNeedle));
        await checkScenario("literal-filename", { q: filenameNeedle }, filenameMatches);
        await checkScenario(
          "english-filename",
          { q: `${runId}-archive` },
          own.filter((row) => row.file_name.includes(`${runId}-archive`)),
        );
        await checkScenario("company-name", { q: companyNames[0] }, own);
        await checkScenario(
          "category",
          { q: runId, category: "payment" },
          own.filter((row) => row.file_type === "payment"),
        );
        for (const source of sources) {
          await checkScenario(
            `source-${source}`,
            { q: runId, source },
            own.filter((row) => row.upload_source === source),
          );
        }
        for (const reviewStatus of ["pending", "verified", "rejected"] as const) {
          await checkScenario(
            `review-${reviewStatus}`,
            { q: runId, reviewStatus },
            own.filter((row) => row.effective_review_status === reviewStatus),
          );
        }
        const combined = filenameMatches.filter(
          (row) =>
            row.file_type === "payment" &&
            row.upload_source === "client" &&
            row.effective_review_status === "pending",
        );
        expect(combined.length).toBeGreaterThan(7);
        await checkScenario(
          "combined-filename-category-source-review",
          { q: filenameNeedle, category: "payment", source: "client", reviewStatus: "pending" },
          combined,
          actors[0],
          7,
        );
        await checkScenario("empty-search", { q: `${runId}-absent` }, []);
        await checkScenario("wrong-team-search", { q: companyNames[0] }, [], actors[1]);
        await checkScenario("other-team-positive-control", { q: runId }, other, actors[1], 3);
        const denied = await listDocumentPageForActor(
          actors[1],
          { q: runId, companyId: companies[0], limit: 37 },
          dependencies,
        );
        expect(denied).toEqual({ documents: [], nextCursor: null });
        observed.wrongTeamCompanyDenied = true;
        await expect(
          listDocumentPageForActor({ ...actors[0], teamId: null }, { q: runId }, dependencies),
        ).rejects.toThrow(/^Forbidden:/);
        await expect(
          bulk.createSnapshot(
            { ...actors[0], teamId: null },
            { resource: "document", filters: { q: runId } },
          ),
        ).rejects.toThrow(/^Forbidden:/);
        observed.noTeamDenied = true;
        await receipt("all-correctness-assertions-passed-uncommitted");
        throw rollback;
      });
      failure = new Error("Owned document-volume transaction unexpectedly committed");
    } catch (error) {
      failure = error;
    } finally {
      try {
        // Awaited read-only teardown checks only exact fresh or returned IDs.
        // All fixture writes and snapshot creation share the rolled-back tx.
        const remaining = await raw<{ resource: string; id: string }[]>`
          select 'team' resource,id::text from teams where id=any(${ownedIds.teams}::uuid[])
          union all select 'user',id::text from users where id=any(${ownedIds.users}::uuid[])
          union all select 'profile',id::text from staff_profiles where id=any(${ownedIds.profiles}::uuid[])
          union all select 'company',id::text from companies where id=any(${ownedIds.companies}::uuid[])
          union all select 'document',id::text from documents where id=any(${ownedIds.documents}::uuid[])
          union all select 'intent',id::text from document_upload_intents where id=any(${ownedIds.intents}::uuid[])
          union all select 'version',id::text from document_versions where id=any(${ownedIds.versions}::uuid[])
          union all select 'snapshot',id::text from bulk_selection_snapshots where id=any(${ownedIds.snapshots}::uuid[])
          order by resource,id`;
        await receipt(
          failure === rollback
            ? "intentional-rollback-completed"
            : "failed-transaction-postread-completed",
          remaining,
        );
        expect(remaining).toEqual([]);
      } finally {
        await raw.end({ timeout: 5 });
      }
    }
    if (failure !== rollback) throw failure;
  }, 120_000);
});
