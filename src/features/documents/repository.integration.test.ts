import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createDocumentRepository } from "./repository";
import { createDocumentScanJobRepository } from "./scan-jobs";

/**
 * The SQL this phase changed is the SQL that lost files, so a source-text
 * assertion would be worthless here: the old expiry sweep and the new one differ
 * by one status value in a WHERE clause, and both compile. These run against a
 * real database.
 *
 * BLOCKED_INTEGRATION: local-postgres -- no Postgres is reachable in the
 * authoring environment, so these are skipped locally and executed by CI, which
 * provisions postgres:17-alpine, migrates and seeds. Skipped is not passed.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

/** Every row this file creates carries it, so cleanup can be exact. */
const KEY_PREFIX = "documents/phase-a-integration/";
const CHECKSUM_A = "a".repeat(64);
const CHECKSUM_B = "b".repeat(64);
const CHECKSUM_C = "c".repeat(64);

type VersionRow = {
  id: string;
  document_id: string;
  version_number: number;
  declared_checksum_sha256: string | null;
  verified_checksum_sha256: string | null;
  verified_at: string | Date | null;
  intent_id: string | null;
  superseded_by_version_id: string | null;
};

let testSql: SqlClient | undefined;

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for document integration tests.");
  }
  testSql ??= createSqlClient(databaseUrl, { max: 4 });
  return testSql;
}

type Fixture = { companyId: string; teamId: string; caseId: string | null; ownerId: string | null };

async function fixture(sql: SqlClient): Promise<Fixture> {
  const companies = await sql<{ id: string; assigned_team_id: string }[]>`
    select id, assigned_team_id from companies order by created_at asc limit 1`;
  if (!companies[0]) throw new Error("Document integration tests need a seeded company.");
  const cases = await sql<{ id: string; owner_id: string }[]>`
    select id, owner_id from annual_return_cases
    where company_id = ${companies[0].id} order by created_at asc limit 1`;
  return {
    companyId: companies[0].id,
    teamId: companies[0].assigned_team_id,
    caseId: cases[0]?.id ?? null,
    ownerId: cases[0]?.owner_id ?? null,
  };
}

function intentInput(fixtureData: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    companyId: fixtureData.companyId,
    caseId: fixtureData.caseId ?? undefined,
    requestedByAuthUserId: "integration-auth-user",
    category: "identity" as const,
    fileName: "passport.pdf",
    contentType: "application/pdf",
    expectedSizeBytes: 4,
    checksum: CHECKSUM_A,
    objectKey: `${KEY_PREFIX}${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/** Checklist items this file marked Received, so the seed row is left as found. */
const touchedChecklistItems = new Set<string>();

async function cleanup(sql: SqlClient): Promise<void> {
  for (const itemId of touchedChecklistItems) {
    await sql`
      update annual_return_checklist_items
      set status = 'Missing', received_at = null, document_id = null
      where id = ${itemId}`;
  }
  touchedChecklistItems.clear();
  await sql`
    delete from document_scan_jobs
    where intent_id in (
      select id from document_upload_intents where object_key like ${KEY_PREFIX + "%"}
    )`;
  await sql`
    delete from documents
    where id in (
      select document_id from document_upload_intents
      where object_key like ${KEY_PREFIX + "%"} and document_id is not null
    )`;
  await sql`delete from document_upload_intents where object_key like ${KEY_PREFIX + "%"}`;
}

async function anyUserId(sql: SqlClient): Promise<string> {
  const rows = await sql<{ id: string }[]>`select id from users order by created_at asc limit 1`;
  if (!rows[0]) throw new Error("Document integration tests need a seeded user.");
  return rows[0].id;
}

async function checklistItemFor(sql: SqlClient, caseId: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    select id from annual_return_checklist_items
    where case_id = ${caseId} order by due_date asc, item_label asc limit 1`;
  return rows[0]?.id ?? null;
}

describe.skipIf(!databaseUrl)("document repository against Postgres", () => {
  afterEach(async () => {
    await cleanup(sqlForTests());
  });

  afterAll(async () => {
    if (testSql) await testSql.end();
  });

  it(
    "gives a received file its own retention window and a scan job, in one transaction",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      expect(intent.quarantineRetentionUntil).toBeNull();

      const document = await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      const stored = await repository.getUploadIntent(intent.id);
      expect(stored?.status).toBe("quarantined");
      // The whole separation: receipt starts a retention window that has nothing
      // to do with the 15-minute upload expiry.
      expect(stored?.quarantineRetentionUntil).not.toBeNull();
      expect(Date.parse(stored!.quarantineRetentionUntil!)).toBeGreaterThan(
        Date.parse(stored!.expiresAt),
      );

      // Scanning used to have no trigger at all. The job is written in the same
      // transaction as the document, so a crash cannot leave received bytes with
      // no outstanding work.
      const jobs = createDocumentScanJobRepository({ sql });
      const queued = await jobs.listForIntent(intent.id);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        status: "pending",
        reason: "initial",
        checksum: CHECKSUM_A,
      });
      expect(document.uploadStatus).toBe("quarantined");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "does not expire or offer for deletion a file that was actually received",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });
      // Expiry already lapsed -- exactly the shape that used to be swept and
      // whose bytes maintenance.ts then deleted.
      await sql`
        update document_upload_intents set expires_at = now() - interval '1 hour'
        where id = ${intent.id}`;

      const expired = await repository.expireUploads(new Date().toISOString());
      expect(expired.map((row) => row.id)).not.toContain(intent.id);

      const stored = await repository.getUploadIntent(intent.id);
      expect(stored?.status).toBe("quarantined");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "still expires an upload that never completed",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      await sql`
        update document_upload_intents set expires_at = now() - interval '1 hour'
        where id = ${intent.id}`;

      const expired = await repository.expireUploads(new Date().toISOString());
      expect(expired.map((row) => row.id)).toContain(intent.id);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "cannot accept and delete the same file when finalize races the expiry sweep",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      // Both orderings, not just ordinary replay: the sweep is what deletes
      // bytes, so it must never return a row a concurrent finalize attached
      // evidence to.
      for (const sweepFirst of [false, true]) {
        const intent = await repository.createUploadIntent(intentInput(data));
        await sql`
          update document_upload_intents set expires_at = now() - interval '1 second'
          where id = ${intent.id}`;

        const now = new Date().toISOString();
        const finalize = repository
          .finalizeUploadIntent({ intentId: intent.id, uploadedBy: null, source: "client" })
          .then(
            () => "finalized" as const,
            () => "refused" as const,
          );
        const sweep = sweepFirst
          ? await repository.expireUploads(now)
          : await Promise.resolve().then(() => repository.expireUploads(now));
        const finalizeOutcome = await finalize;

        const stored = await repository.getUploadIntent(intent.id);
        const sweptThisIntent = sweep.some((row) => row.id === intent.id);

        // The invariant: a swept row -- the only kind whose bytes get deleted --
        // never has a document attached, and a finalized row is never swept.
        if (sweptThisIntent) {
          expect(stored?.documentId).toBeNull();
          expect(finalizeOutcome).toBe("refused");
        } else {
          expect(stored?.documentId === null || stored?.status === "quarantined").toBe(true);
        }
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "accepts a second person's document in a category another verified document occupies",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const first = await repository.createUploadIntent(intentInput(data));
      const firstDocument = await repository.finalizeUploadIntent({
        intentId: first.id,
        uploadedBy: null,
        source: "client",
      });
      await repository.recordScanResult(
        first.id,
        { status: "clean", providerReference: "integration-clean" },
        { verdictSource: "provider", expectedChecksum: CHECKSUM_A },
      );
      const verified = await repository.reviewDocument({
        documentId: firstDocument.id,
        reviewerId: data.ownerId ?? (await anyUserId(sql)),
        decision: "verified",
      });
      expect(verified.reviewStatus).toBe("verified");

      // Director B. This used to throw "Accepted documents are immutable."
      const second = await repository.createUploadIntent(
        intentInput(data, { checksum: CHECKSUM_B, fileName: "passport-two.pdf" }),
      );
      expect(second.id).not.toBe(first.id);

      // And the first approval is untouched -- additive, never superseding.
      const firstAfter = await repository.getDocument(firstDocument.id);
      expect(firstAfter?.reviewStatus).toBe("verified");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "refuses a verdict computed over content the intent no longer carries",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      await expect(
        repository.recordScanResult(
          intent.id,
          { status: "clean", providerReference: "stale" },
          { verdictSource: "provider", expectedChecksum: CHECKSUM_B },
        ),
      ).rejects.toThrow(/not quarantined/i);

      const stored = await repository.getUploadIntent(intent.id);
      expect(stored?.status).toBe("quarantined");
      expect(stored?.scanVerdictSource).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "resolves the authoritative scope of a document from companies and cases",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      const document = await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      const bySubject = await repository.getDocumentAccessSubject(document.id);
      expect(bySubject).toMatchObject({ companyId: data.companyId, companyTeamId: data.teamId });
      if (data.caseId) expect(bySubject?.caseOwnerId).toBe(data.ownerId);

      const byIntent = await repository.getIntentAccessSubject(intent.id);
      expect(byIntent).toMatchObject({ companyId: data.companyId, companyTeamId: data.teamId });

      expect(await repository.getDocumentAccessSubject(crypto.randomUUID())).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "does not attach another company's case owner to a company scope lookup",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const otherCase = await sql<{ id: string }[]>`
        select id from annual_return_cases where company_id <> ${data.companyId}
        order by created_at asc limit 1`;
      if (!otherCase[0]) return;

      const subject = await repository.getCompanyAccessSubject(data.companyId, otherCase[0].id);
      expect(subject).toMatchObject({ companyId: data.companyId });
      // The case belongs to a different company, so it contributes no assignment.
      expect(subject?.caseId).toBeNull();
      expect(subject?.caseOwnerId).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "surfaces a received file whose retention window lapsed without deleting it",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });
      await sql`
        update document_upload_intents set quarantine_retention_until = now() - interval '1 day'
        where id = ${intent.id}`;

      const stalled = await repository.listStalledQuarantine(new Date().toISOString());
      expect(stalled.map((row) => row.id)).toContain(intent.id);

      // Reporting only. The row is still there and still quarantined.
      const stored = await repository.getUploadIntent(intent.id);
      expect(stored?.status).toBe("quarantined");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "enqueues one job per content version and no duplicate on replay",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const jobs = createDocumentScanJobRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      // A retried worker enqueueing the same content must not create a second job.
      await jobs.enqueue({ intentId: intent.id, checksum: CHECKSUM_A, reason: "initial" });
      expect(await jobs.listForIntent(intent.id)).toHaveLength(1);

      // A genuine re-scan is a different question about the same bytes.
      await jobs.enqueue({ intentId: intent.id, checksum: CHECKSUM_A, reason: "rescan" });
      expect(await jobs.listForIntent(intent.id)).toHaveLength(2);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "claims a job once and fences terminal writes on the claim's attempt count",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const jobs = createDocumentScanJobRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      const now = new Date().toISOString();
      const claimed = await jobs.claimDue(now, 100);
      const mine = claimed.find((job) => job.intentId === intent.id);
      expect(mine).toBeDefined();
      expect(mine!.attemptCount).toBe(1);

      // A stale claim -- an expired worker coming back -- must not overwrite the
      // newer attempt's result.
      expect(await jobs.markSucceeded(mine!.id, { now, attemptCount: 99 })).toBe(false);
      expect(await jobs.markSucceeded(mine!.id, { now, attemptCount: 1 })).toBe(true);
      // And the winning write is not applied twice.
      expect(await jobs.markSucceeded(mine!.id, { now, attemptCount: 1 })).toBe(false);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "marks the checklist item received in the same transaction as the document",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);
      if (!data.caseId) return;
      const itemId = await checklistItemFor(sql, data.caseId);
      if (!itemId) return;
      touchedChecklistItems.add(itemId);
      await sql`
        update annual_return_checklist_items
        set status = 'Missing', received_at = null, document_id = null where id = ${itemId}`;

      const intent = await repository.createUploadIntent(
        intentInput(data, { checklistItemId: itemId }),
      );
      const document = await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      const rows = await sql<
        { status: string; document_id: string | null; received_at: string | null }[]
      >`
        select status, document_id, received_at::text as received_at
        from annual_return_checklist_items where id = ${itemId}`;
      // The whole point: the requirement can no longer read "Missing" while the
      // document that answers it is sitting in quarantine.
      expect(rows[0]?.status).toBe("Received");
      expect(rows[0]?.document_id).toBe(document.id);
      expect(rows[0]?.received_at).not.toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "does not overwrite a verified requirement with a later upload",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);
      if (!data.caseId) return;
      const itemId = await checklistItemFor(sql, data.caseId);
      if (!itemId) return;
      touchedChecklistItems.add(itemId);
      // An approval is a human decision about specific bytes; a later upload is
      // additional evidence, not grounds to undo it.
      await sql`
        update annual_return_checklist_items
        set status = 'Verified', verified_at = now() where id = ${itemId}`;

      const intent = await repository.createUploadIntent(
        intentInput(data, { checklistItemId: itemId, checksum: CHECKSUM_B }),
      );
      await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      const rows = await sql<{ status: string }[]>`
        select status from annual_return_checklist_items where id = ${itemId}`;
      expect(rows[0]?.status).toBe("Verified");

      await sql`update annual_return_checklist_items set verified_at = null where id = ${itemId}`;
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "refuses a checklist item that belongs to another case",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);
      if (!data.caseId) return;

      const otherItem = await sql<{ id: string }[]>`
        select i.id from annual_return_checklist_items i
        where i.case_id <> ${data.caseId} limit 1`;
      if (!otherItem[0]) return;

      // Without this check a client-supplied item id from another company's case
      // would let one client's upload satisfy another client's requirement.
      await expect(
        repository.createUploadIntent(intentInput(data, { checklistItemId: otherItem[0].id })),
      ).rejects.toThrow(/does not belong to the case/i);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "leaves the checklist alone for an upload that names no requirement",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);
      if (!data.caseId) return;
      const itemId = await checklistItemFor(sql, data.caseId);
      if (!itemId) return;

      const before = await sql<{ status: string }[]>`
        select status from annual_return_checklist_items where id = ${itemId}`;

      const intent = await repository.createUploadIntent(intentInput(data));
      await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      // Unassigned evidence a person maps, not a silent guess at which
      // requirement it answers.
      const after = await sql<{ status: string }[]>`
        select status from annual_return_checklist_items where id = ${itemId}`;
      expect(after[0]?.status).toBe(before[0]?.status);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  // Phase C-1. The declared/verified split is the whole point of the version
  // table, and it lives entirely in SQL: a source-text assertion would pass
  // against a column that writes the client's claim into `verified`.
  it(
    "gives every received document a version 1 carrying the claim, not an identity",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      const document = await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      const versions = await sql<VersionRow[]>`
        select * from document_versions where document_id = ${document.id}`;
      expect(versions).toHaveLength(1);
      expect(versions[0].version_number).toBe(1);
      expect(versions[0].intent_id).toBe(intent.id);
      expect(versions[0].superseded_by_version_id).toBeNull();

      // The client supplied this before the bytes existed, so it is recorded as
      // a claim and nothing has verified it.
      expect(versions[0].declared_checksum_sha256).toBe(CHECKSUM_A);
      expect(versions[0].verified_checksum_sha256).toBeNull();
      expect(versions[0].verified_at).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "records a content identity only from a scanner that read the bytes",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      const document = await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      await repository.recordScanResult(
        intent.id,
        {
          status: "clean",
          providerReference: "integration-provider-ref",
          verifiedChecksum: CHECKSUM_B,
          verifiedByteSize: 4,
        },
        { verdictSource: "provider" },
      );

      const versions = await sql<VersionRow[]>`
        select * from document_versions where document_id = ${document.id}`;
      expect(versions[0].verified_checksum_sha256).toBe(CHECKSUM_B);
      expect(versions[0].verified_at).not.toBeNull();
      // The claim is kept beside it rather than overwritten: the two disagreeing
      // is itself a finding, and it cannot be one if only one value survives.
      expect(versions[0].declared_checksum_sha256).toBe(CHECKSUM_A);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  // The load-bearing case. The fixture scanner returns clean for almost every
  // input without reading anything, so if a clean verdict alone were enough to
  // set an identity, every document in a non-provider deployment would carry a
  // hash that certifies nothing -- and the package manifest would accept it.
  it(
    "leaves the identity unset when a clean verdict carries no hash",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      const document = await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      await repository.recordScanResult(
        intent.id,
        { status: "clean", providerReference: "fixture-clean" },
        { verdictSource: "deterministic" },
      );

      const versions = await sql<VersionRow[]>`
        select verified_checksum_sha256, verified_at from document_versions
        where document_id = ${document.id}`;
      expect(versions[0].verified_checksum_sha256).toBeNull();
      expect(versions[0].verified_at).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "does not restate an identity a later verdict disagrees with",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      const document = await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      await repository.recordScanResult(
        intent.id,
        { status: "clean", providerReference: "first", verifiedChecksum: CHECKSUM_B },
        { verdictSource: "provider" },
      );
      // A re-scan of an already-released file, which is the one path that may
      // land a second verdict. It must not silently move the bytes underneath a
      // decision already recorded against them.
      await repository.recordScanResult(
        intent.id,
        { status: "clean", providerReference: "second", verifiedChecksum: CHECKSUM_C },
        { verdictSource: "provider", allowStatuses: ["available"] },
      );

      const versions = await sql<VersionRow[]>`
        select verified_checksum_sha256 from document_versions
        where document_id = ${document.id}`;
      expect(versions[0].verified_checksum_sha256).toBe(CHECKSUM_B);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  // Enforced by the partial unique index rather than by the code that reads it,
  // so that `currentVersion` never has to choose between two live rows.
  it(
    "refuses a second current version of the same document",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      const document = await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });

      await expect(
        sql`
          insert into document_versions (
            document_id, version_number, file_name, storage_url
          ) values (${document.id}, 2, 'second.pdf', ${`${KEY_PREFIX}second`})`,
      ).rejects.toThrow();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
