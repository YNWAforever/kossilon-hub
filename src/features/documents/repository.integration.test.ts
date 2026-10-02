import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createDocumentAnalysisRepository } from "./analysis-repository";
import { createDocumentRepository } from "./repository";
import { createDocumentScanJobRepository } from "./scan-jobs";
import {
  documentFiltersForActor,
  listDocumentsForActor,
  downloadDocumentForActor,
  createDocumentUploadIntentForActor,
} from "./server-fns";
import {
  requireClientCompanyAccess,
  type NeonSessionAdapter,
} from "@/features/auth/neon-auth-server";
import { vi } from "vitest";
import type postgres from "postgres";
import { isDocumentVisibleToStaffActor } from "./authorization";
import { documentSafetyOf } from "./safety";
import type { AuthenticatedActor } from "@/features/auth/types";

/**
 * The SQL this phase changed is the SQL that lost files, so a source-text
 * assertion would be worthless here: the old expiry sweep and the new one differ
 * by one status value in a WHERE clause, and both compile. These run against a
 * real database.
 *
 * TEST_DATABASE_URL selects an isolated migrated and seeded Postgres instance.
 * CI provisions postgres:17-alpine. Skipped is not passed.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

describe.skipIf(!databaseUrl)("versioned analysis publication", () => {
  it(
    "filters shared evidence by document scope even for a cross-team case owner",
    async () => {
      const rollback = new Error("owned shared findings scope rollback");
      await expect(
        sqlForTests().begin(async (tx) => {
          const data = await fixture(tx as unknown as SqlClient);
          // Resolution refreshes the authoritative profile. A seeded case owner
          // can be an Admin, so an injected Staff DTO does not make that owner a
          // Staff actor. Create the actual role this denial test requires.
          const scopedStaffId = crypto.randomUUID();
          await tx`insert into users(id,name,email,role,team_id,active) values(${scopedStaffId},'Owned scoped Staff',${scopedStaffId + "@example.test"},'Staff',${data.teamId},true)`;
          await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values(${scopedStaffId},${"owned-scope-" + scopedStaffId},'Staff',${data.teamId},true)`;
          await tx`update annual_return_cases set owner_id=${scopedStaffId} where id=${data.caseId!}`;
          data.ownerId = scopedStaffId;
          const repo = createDocumentRepository({ sql: tx });
          const analysis = createDocumentAnalysisRepository({ sql: tx });
          const [otherTeam] = await tx<
            { id: string }[]
          >`insert into teams(name) values('owned shared findings team') returning id`;
          await tx`update companies set assigned_team_id=${otherTeam.id} where id=${data.companyId}`;
          const directIntent = await repo.createUploadIntent(intentInput(data));
          const direct = await repo.finalizeUploadIntent({
            intentId: directIntent.id,
            uploadedBy: null,
            source: "staff",
          });
          const sharedIntent = await repo.createUploadIntent(
            intentInput(data, { caseId: undefined }),
          );
          const shared = await repo.finalizeUploadIntent({
            intentId: sharedIntent.id,
            uploadedBy: null,
            source: "staff",
          });
          const [requirement] = await tx<
            { id: string }[]
          >`insert into case_requirement_instances(case_id,checklist_item_id,requirement_key,template_version) select case_id,id,${`owned-shared-${crypto.randomUUID()}`},'synthetic-local' from annual_return_checklist_items where case_id=${data.caseId!} limit 1 returning id`;
          expect(requirement).toBeDefined();
          await tx`insert into requirement_evidence_links(requirement_instance_id,document_id) values(${requirement.id},${shared.id})`;
          const actor: AuthenticatedActor = {
            authUserId: "owned-scope",
            userId: data.ownerId!,
            teamId: data.teamId,
            role: "Staff",
            active: true,
          };
          const visible = await analysis.listFindingsForCase(data.caseId!, actor);
          expect(visible.some((view) => view.documentId === direct.id)).toBe(true);
          expect(visible.some((view) => view.documentId === shared.id)).toBe(false);
          const [identity] = await tx<
            { auth_user_id: string }[]
          >`select auth_user_id from staff_profiles where user_id=${data.ownerId!}`;
          const [finding] = await tx<
            { id: string }[]
          >`insert into document_findings(document_version_id,tier,rule_key,rule_version,outcome,severity,detail) values(${shared.currentVersionId!},'cross-check','owned-scope-denial','1','uncertain','info','Owned shared scope') returning id`;
          await expect(
            analysis.resolveFinding({
              findingId: finding.id,
              caseId: data.caseId!,
              resolvedByUserId: data.ownerId!,
              resolvedByAuthUserId: identity.auth_user_id,
              expectedDocumentVersionId: shared.currentVersionId!,
              note: null,
            }),
          ).rejects.toThrow(/outside your scope/);
          expect(
            (await analysis.listFindingsForCase(data.caseId!, { ...actor, role: "Admin" })).some(
              (view) => view.documentId === shared.id,
            ),
          ).toBe(true);
          expect(
            await analysis.listFindingsForCase(data.caseId!, { ...actor, active: false }),
          ).toEqual([]);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it.each(["linked", "unlinked"])(
    "resolves only a currently linked shared finding: %s",
    async (mode) => {
      const rollback = new Error("owned shared finding resolution rollback");
      await expect(
        sqlForTests().begin(async (tx) => {
          const data = await fixture(tx as unknown as SqlClient);
          const repo = createDocumentRepository({ sql: tx });
          const analysis = createDocumentAnalysisRepository({ sql: tx });
          const intent = await repo.createUploadIntent(intentInput(data, { caseId: undefined }));
          const shared = await repo.finalizeUploadIntent({
            intentId: intent.id,
            uploadedBy: null,
            source: "staff",
          });
          const [requirement] = await tx<
            { id: string }[]
          >`insert into case_requirement_instances(case_id,checklist_item_id,requirement_key,template_version) select case_id,id,${`owned-shared-${crypto.randomUUID()}`},'synthetic-local' from annual_return_checklist_items where case_id=${data.caseId!} limit 1 returning id`;
          if (mode === "linked")
            await tx`insert into requirement_evidence_links(requirement_instance_id,document_id) values(${requirement.id},${shared.id})`;
          const [admin] = await tx<
            { id: string; auth_user_id: string }[]
          >`select u.id,sp.auth_user_id from users u join staff_profiles sp on sp.user_id=u.id where u.role='Admin' and u.active and sp.active limit 1`;
          const [finding] = await tx<
            { id: string }[]
          >`insert into document_findings(document_version_id,tier,rule_key,rule_version,outcome,severity,detail) values(${shared.currentVersionId!},'cross-check','owned-shared','1','uncertain','info','Owned shared evidence') returning id`;
          const input = {
            findingId: finding.id,
            caseId: data.caseId!,
            resolvedByUserId: admin.id,
            resolvedByAuthUserId: admin.auth_user_id,
            expectedDocumentVersionId: shared.currentVersionId!,
            note: "Owned local review",
          };
          expect(await analysis.resolveFinding(input)).toBe(mode === "linked");
          expect(await analysis.resolveFinding(input)).toBe(false);
          const [audit] = await tx<
            { count: number }[]
          >`select count(*)::int count from timeline_events where event_type='document_finding_resolved' and metadata->>'findingId'=${finding.id}`;
          expect(audit.count).toBe(mode === "linked" ? 1 : 0);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "requires a current verified identity and attributes a current finding resolution once",
    async () => {
      const rollback = new Error("owned resolution and revoke rollback");
      await expect(
        sqlForTests().begin(async (tx) => {
          const repo = createDocumentRepository({ sql: tx });
          const analysis = createDocumentAnalysisRepository({ sql: tx });
          const data = await fixture(tx as unknown as SqlClient);
          const intent = await repo.createUploadIntent(intentInput(data));
          const document = await repo.finalizeUploadIntent({
            intentId: intent.id,
            uploadedBy: null,
            source: "staff",
          });
          const [finding] = await tx<
            { id: string }[]
          >`insert into document_findings(document_version_id,tier,rule_key,rule_version,outcome,severity,detail) values(${document.currentVersionId!},'cross-check','synthetic-review','1','uncertain','info','Owned synthetic finding') returning id`;
          const [identity] = await tx<
            { auth_user_id: string }[]
          >`select auth_user_id from staff_profiles where user_id=${data.ownerId!}`;
          const input = {
            findingId: finding.id,
            caseId: data.caseId!,
            resolvedByUserId: data.ownerId!,
            resolvedByAuthUserId: identity.auth_user_id,
            expectedDocumentVersionId: document.currentVersionId!,
            note: "Synthetic local review",
          };
          await expect(
            analysis.resolveFinding({ ...input, resolvedByAuthUserId: "wrong-auth" }),
          ).rejects.toThrow(/verified staff/);
          await tx`update staff_profiles set active=false where user_id=${data.ownerId!}`;
          await expect(analysis.resolveFinding(input)).rejects.toThrow(/verified staff/);
          await tx`update staff_profiles set active=true where user_id=${data.ownerId!}`;
          expect(await analysis.resolveFinding(input)).toBe(true);
          expect(await analysis.resolveFinding(input)).toBe(false);
          const [audit] = await tx<
            { count: number }[]
          >`select count(*)::int count from timeline_events where event_type='document_finding_resolved' and metadata->>'findingId'=${finding.id} and actor_id=${data.ownerId!}`;
          expect(audit.count).toBe(1);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
  it(
    "does not resolve a finding for a replaced version or a mismatched inspected version",
    async () => {
      const rollback = new Error("owned analysis review rollback");
      await expect(
        sqlForTests().begin(async (tx) => {
          const repo = createDocumentRepository({ sql: tx });
          const analysis = createDocumentAnalysisRepository({ sql: tx });
          const data = await fixture(tx as unknown as SqlClient);
          const intent = await repo.createUploadIntent(intentInput(data));
          const document = await repo.finalizeUploadIntent({
            intentId: intent.id,
            uploadedBy: null,
            source: "staff",
          });
          const versionId = document.currentVersionId!;
          const [finding] = await tx<
            { id: string }[]
          >`insert into document_findings(document_version_id,tier,rule_key,rule_version,outcome,severity,detail)
        values(${versionId},'cross-check','synthetic','1','uncertain','info','synthetic owned finding') returning id`;
          expect(
            await analysis.resolveFinding({
              findingId: finding.id,
              caseId: data.caseId!,
              resolvedByUserId: data.ownerId!,
              note: "local contract",
              expectedDocumentVersionId: crypto.randomUUID(),
            }),
          ).toBe(false);
          const [v2] = await tx<
            { id: string }[]
          >`insert into document_versions(document_id,version_number,file_name,storage_url,superseded_by_version_id,superseded_at)
        values(${document.id},2,'synthetic-V2.pdf',${`${KEY_PREFIX}analysis-v2`},${versionId},now()) returning id`;
          await tx`update document_versions set superseded_by_version_id=${v2.id},superseded_at=now() where id=${versionId}`;
          await tx`update document_versions set superseded_by_version_id=null,superseded_at=null where id=${v2.id}`;
          expect(
            await analysis.resolveFinding({
              findingId: finding.id,
              caseId: data.caseId!,
              resolvedByUserId: data.ownerId!,
              note: "local contract",
              expectedDocumentVersionId: versionId,
            }),
          ).toBe(false);
          expect(
            (
              await tx<
                { resolved_by: string | null }[]
              >`select resolved_by from document_findings where id=${finding.id}`
            )[0].resolved_by,
          ).toBeNull();
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
  it.each(["success", "reclaimed", "context-changed"])(
    "publishes text/findings/provenance atomically with the current job fence: %s",
    async (mode) => {
      const rollback = new Error("owned analysis publication rollback");
      await expect(
        sqlForTests().begin(async (tx) => {
          const repo = createDocumentRepository({ sql: tx });
          const analysis = createDocumentAnalysisRepository({ sql: tx });
          const data = await fixture(tx as unknown as SqlClient);
          const intent = await repo.createUploadIntent(intentInput(data));
          const document = await repo.finalizeUploadIntent({
            intentId: intent.id,
            uploadedBy: null,
            source: "staff",
          });
          const versionId = document.currentVersionId!;
          await repo.recordScanResult(
            intent.id,
            {
              status: "clean",
              providerReference: "synthetic-not-live",
              verifiedChecksum: CHECKSUM_A,
              verifiedByteSize: 4,
              documentVersionId: versionId,
            },
            { verdictSource: "provider", expectedVersionId: versionId },
          );
          const subject = await analysis.loadForAnalysis(versionId);
          const [job] = await tx<
            { id: string }[]
          >`update document_analysis_jobs set status='processing',attempt_count=1 where document_version_id=${versionId} returning id`;
          if (mode === "reclaimed")
            await tx`update document_analysis_jobs set attempt_count=2 where id=${job.id}`;
          if (mode === "context-changed")
            await tx`update companies set company_name=company_name||' changed' where id=${data.companyId}`;
          const evidence = {
            documentVersionId: versionId,
            sha256: CHECKSUM_A,
            method: "text-layer" as const,
            pageCount: 1,
            truncated: false,
            unknownReason: null,
            pages: [
              {
                page: 1,
                text: "Synthetic owned text",
                method: "text-layer" as const,
                confidence: null,
                spans: [{ page: 1, start: 0, end: 20, quote: "Synthetic owned text" }],
              },
            ],
            provenance: {
              extractorVersion: "synthetic-local",
              providerReference: null,
              model: null,
              cost: null,
            },
          };
          const input = {
            documentVersionId: versionId,
            analysisJobId: job.id,
            attemptCount: 1,
            sha256: CHECKSUM_A,
            contextVersion: subject!.contextVersion,
            evidence,
            extraction: {
              method: "text-layer" as const,
              text: "Synthetic owned text",
              pageCount: 1,
              truncated: false,
              extractorVersion: "synthetic-local",
              evidence,
            },
            findings: [
              {
                ruleKey: "synthetic-bound",
                ruleVersion: "1",
                tier: "cross-check" as const,
                outcome: "uncertain" as const,
                severity: "info" as const,
                detail: "Local metadata contract only",
                citation: {
                  kind: "version" as const,
                  documentVersionId: versionId,
                  pageFrom: 1,
                  pageTo: 1,
                },
              },
            ],
            provenance: {
              schemaVersion: "synthetic-local",
              model: null,
              cost: null,
              advisoryOnly: true,
            },
          };
          expect(await analysis.publishAnalysis(input)).toBe(mode === "success");
          if (mode === "success") expect(await analysis.publishAnalysis(input)).toBe(false);
          const [counts] = await tx<
            { texts: number; findings: number; status: string; provenance: unknown }[]
          >`select
        (select count(*)::int from document_version_texts where document_version_id=${versionId}) texts,
        (select count(*)::int from document_findings where document_version_id=${versionId}) findings,
        status,provenance from document_analysis_jobs where id=${job.id}`;
          expect(counts.texts).toBe(mode === "success" ? 1 : 0);
          expect(counts.findings).toBe(mode === "success" ? 1 : 0);
          expect(counts.status).toBe(mode === "success" ? "succeeded" : "processing");
          if (mode === "success") expect(counts.provenance).toEqual(input.provenance);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});

describe.skipIf(!databaseUrl)("version-bound scan persistence", () => {
  it("retains the V1 review history without approving V2 or trusting a legacy unbound scan", async () => {
    const rollback = new Error("review version fixture rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const repo = createDocumentRepository({ sql: tx });
        const data = await fixture(tx as unknown as SqlClient);
        const intent = await repo.createUploadIntent(intentInput(data));
        const document = await repo.finalizeUploadIntent({
          intentId: intent.id,
          uploadedBy: null,
          source: "staff",
        });
        const v1 = document.currentVersionId!;
        await repo.recordScanResult(
          intent.id,
          {
            status: "clean",
            providerReference: "synthetic-not-live",
            verifiedChecksum: CHECKSUM_A,
            verifiedByteSize: 4,
            documentVersionId: v1,
          },
          { verdictSource: "provider", expectedVersionId: v1 },
        );
        await repo.reviewDocument({
          documentId: document.id,
          expectedVersionId: v1,
          reviewerId: data.ownerId!,
          decision: "verified",
        });
        await tx`update document_upload_intents set scan_document_version_id=null where id=${intent.id}`;
        expect(
          (await repo.listDocuments({ caseId: data.caseId! })).find((d) => d.id === document.id)
            ?.availability,
        ).toBe("unscanned");
        const [v2] = await tx<
          { id: string }[]
        >`insert into document_versions(document_id,version_number,file_name,storage_url,superseded_by_version_id,superseded_at)
        values(${document.id},2,'synthetic-V2.pdf',${`${KEY_PREFIX}replacement-v2`},${v1},now()) returning id`;
        await tx`update document_versions set superseded_by_version_id=${v2.id},superseded_at=now() where id=${v1}`;
        await tx`update document_versions set superseded_by_version_id=null,superseded_at=null where id=${v2.id}`;
        const summary = (await repo.listDocuments({ caseId: data.caseId! })).find(
          (d) => d.id === document.id,
        )!;
        expect(summary.currentVersionId).toBe(v2.id);
        expect(summary.reviewStatus).toBe("pending");
        expect(summary.reviewedVersionId).toBe(v1);
        const [stored] = await tx<
          { verification_status: string }[]
        >`select verification_status from documents where id=${document.id}`;
        expect(stored.verification_status).toBe("verified");
        const [history] = await tx<
          { metadata: { documentVersionId: string } }[]
        >`select metadata from timeline_events
        where event_type='document_reviewed' and metadata->>'documentId'=${document.id}`;
        expect(history.metadata.documentVersionId).toBe(v1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it("refuses an approval for an older version even when the current scan is clean", async () => {
    const sql = sqlForTests();
    const repo = createDocumentRepository({ sql });
    const data = await fixture(sql);
    const intent = await repo.createUploadIntent(intentInput(data));
    const document = await repo.finalizeUploadIntent({
      intentId: intent.id,
      uploadedBy: null,
      source: "staff",
    });
    const [version] = await sql<
      { id: string }[]
    >`select id from document_versions where document_id=${document.id}`;
    await repo.recordScanResult(
      intent.id,
      {
        status: "clean",
        providerReference: "stub-not-live",
        verifiedChecksum: CHECKSUM_A,
        verifiedByteSize: 4,
        documentVersionId: version.id,
      },
      { verdictSource: "provider", expectedVersionId: version.id },
    );
    await expect(
      repo.reviewDocument({
        documentId: document.id,
        expectedVersionId: crypto.randomUUID(),
        reviewerId: data.ownerId ?? (await anyUserId(sql)),
        decision: "verified",
      }),
    ).rejects.toThrow(/version/i);
    expect((await repo.getDocument(document.id))?.reviewStatus).toBe("pending");
  });
  it("refuses a provider identity that disagrees with the received intent", async () => {
    const sql = sqlForTests();
    const repo = createDocumentRepository({ sql });
    const data = await fixture(sql);
    const intent = await repo.createUploadIntent(intentInput(data));
    const document = await repo.finalizeUploadIntent({
      intentId: intent.id,
      uploadedBy: null,
      source: "staff",
    });
    const [version] = await sql<
      { id: string }[]
    >`select id from document_versions where document_id=${document.id}`;
    await expect(
      repo.recordScanResult(
        intent.id,
        {
          status: "clean",
          providerReference: "stub-not-live",
          verifiedChecksum: CHECKSUM_B,
          verifiedByteSize: 4,
          documentVersionId: version.id,
        },
        { verdictSource: "provider", expectedChecksum: CHECKSUM_A, expectedVersionId: version.id },
      ),
    ).rejects.toThrow(/checksum/i);
    expect((await repo.getUploadIntent(intent.id))?.status).toBe("quarantined");
    expect(
      (
        await sql<
          { hash: string | null }[]
        >`select verified_checksum_sha256 hash from document_versions where id=${version.id}`
      )[0].hash,
    ).toBeNull();
  });

  it("refuses a superseded V1 verdict without releasing V2", async () => {
    const rollback = new Error("owned version race rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const sql = tx;
        const repo = createDocumentRepository({ sql: tx });
        const data = await fixture(tx as unknown as SqlClient);
        const intent = await repo.createUploadIntent(intentInput(data));
        const document = await repo.finalizeUploadIntent({
          intentId: intent.id,
          uploadedBy: null,
          source: "staff",
        });
        const [v1] = await sql<
          { id: string }[]
        >`select id from document_versions where document_id=${document.id}`;
        const [v2] = await sql<
          { id: string }[]
        >`insert into document_versions(document_id,version_number,file_name,storage_url,superseded_by_version_id,superseded_at)
      values(${document.id},2,'replacement.pdf',${`${KEY_PREFIX}replacement`},${v1.id},now()) returning id`;
        await sql`update document_versions set superseded_by_version_id=${v2.id},superseded_at=now() where id=${v1.id}`;
        await sql`update document_versions set superseded_by_version_id=null,superseded_at=null where id=${v2.id}`;
        await expect(
          repo.recordScanResult(
            intent.id,
            {
              status: "clean",
              providerReference: "stub-not-live",
              verifiedChecksum: CHECKSUM_A,
              verifiedByteSize: 4,
              documentVersionId: v1.id,
            },
            { verdictSource: "provider", expectedChecksum: CHECKSUM_A, expectedVersionId: v1.id },
          ),
        ).rejects.toThrow(/version|superseded/i);
        expect((await repo.getUploadIntent(intent.id))?.status).toBe("quarantined");
        const [latest] = await sql<
          { hash: string | null }[]
        >`select verified_checksum_sha256 hash from document_versions where id=${v2.id}`;
        expect(latest.hash).toBeNull();
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("fences the verdict write itself after a scan job was reclaimed", async () => {
    const sql = sqlForTests();
    const repo = createDocumentRepository({ sql });
    const data = await fixture(sql);
    const intent = await repo.createUploadIntent(intentInput(data));
    const document = await repo.finalizeUploadIntent({
      intentId: intent.id,
      uploadedBy: null,
      source: "staff",
    });
    const [version] = await sql<
      { id: string }[]
    >`select id from document_versions where document_id=${document.id}`;
    const [job] = await sql<
      { id: string }[]
    >`update document_scan_jobs set status='processing',attempt_count=2 where intent_id=${intent.id} returning id`;
    await expect(
      repo.recordScanResult(
        intent.id,
        {
          status: "clean",
          providerReference: "stub-not-live",
          verifiedChecksum: CHECKSUM_A,
          verifiedByteSize: 4,
          documentVersionId: version.id,
        },
        {
          verdictSource: "provider",
          expectedChecksum: CHECKSUM_A,
          expectedVersionId: version.id,
          scanJobClaim: { jobId: job.id, attemptCount: 1 },
        },
      ),
    ).rejects.toThrow(/claim|attempt/i);
    expect((await repo.getUploadIntent(intent.id))?.status).toBe("quarantined");
    expect(
      (
        await sql<
          { hash: string | null }[]
        >`select verified_checksum_sha256 hash from document_versions where id=${version.id}`
      )[0].hash,
    ).toBeNull();
  });
});

describe.skipIf(!databaseUrl)("metadata document lineage", () => {
  it("retains a verified DB chain while accepting only server-observed missing-object recovery", async () => {
    const rolledBack = new Error("missing object chain rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const data = await fixture(tx as unknown as SqlClient);
        const repo = createDocumentRepository({ sql: tx });
        const originalIntent = await repo.createUploadIntent(intentInput(data));
        const original = await repo.finalizeUploadIntent({
          intentId: originalIntent.id,
          uploadedBy: null,
          source: "staff",
        });
        await repo.recordScanResult(
          originalIntent.id,
          {
            status: "clean",
            providerReference: "isolated-missing-object-contract",
            verifiedChecksum: CHECKSUM_A,
            verifiedByteSize: 4,
          },
          { verdictSource: "provider" },
        );
        const preview = await repo.getDocumentRecoveryPreview(original.id);
        expect(preview?.availability).toBe("available");
        const input = {
          ...intentInput(data),
          recovery: {
            documentId: original.id,
            expectedToken: preview!.versionToken,
            reason: "Storage inspection confirmed absent",
          },
          recoveryApprovedBy: data.ownerId!,
        };
        await expect(repo.createUploadIntent(input)).rejects.toThrow(/complete verified chain/);
        const replacement = await repo.createUploadIntent({
          ...input,
          recoveryObjectState: "missing",
          recoveryObjectObservedAt: "2026-10-01T00:00:00Z",
        });
        const recovered = await repo.finalizeUploadIntent({
          intentId: replacement.id,
          uploadedBy: data.ownerId,
          source: "staff",
        });
        expect(recovered.id).not.toBe(original.id);
        expect(recovered.uploadStatus).toBe("quarantined");
        expect((await repo.getDocument(original.id))?.availability).toBe("available");
        const [event] = await tx<
          { metadata: { objectState: string } }[]
        >`select metadata from timeline_events where event_type='document_recovery_requested' and metadata->>'intentId'=${replacement.id}`;
        expect(event.metadata.objectState).toBe("missing");
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });
  it.each(["replacement", "scanner"] as const)(
    "does not deadlock recovery against concurrent %s locks",
    async (otherKind) => {
      const sql = sqlForTests();
      const data = await fixture(sql);
      const repo = createDocumentRepository({ sql });
      let sourceId: string;
      let sourceIntentId: string | undefined;
      if (otherKind === "scanner") {
        const intent = await repo.createUploadIntent(intentInput(data));
        sourceIntentId = intent.id;
        sourceId = (
          await repo.finalizeUploadIntent({
            intentId: intent.id,
            uploadedBy: null,
            source: "staff",
          })
        ).id;
      } else {
        const [source] = await sql<
          { id: string }[]
        >`insert into documents(company_id,case_id,file_type,file_name,storage_url,upload_source,verification_status)
        values(${data.companyId},${data.caseId},'identity','concurrent.pdf',${`${KEY_PREFIX}concurrent`},'system','rejected') returning id`;
        sourceId = source.id;
      }
      const preview = await repo.getDocumentRecoveryPreview(sourceId);
      let reachedSource!: () => void;
      const sourceLocked = new Promise<void>((resolve) => {
        reachedSource = resolve;
      });
      let releaseSource!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseSource = resolve;
      });
      let reachedOther!: () => void;
      const otherLocked = new Promise<void>((resolve) => {
        reachedOther = resolve;
      });
      const wrap = (tx: postgres.TransactionSql, after: (text: string) => Promise<void>) =>
        Object.assign(
          async (parts: TemplateStringsArray, ...values: unknown[]) => {
            const rows = await tx(parts, ...(values as never[]));
            await after(parts.join(" "));
            return rows;
          },
          { json: tx.json },
        ) as unknown as postgres.TransactionSql;
      let paused = false;
      const recovery = sql.begin(async (tx) =>
        createDocumentRepository({
          sql: wrap(tx, async (text) => {
            if (
              !paused &&
              text.includes("for update") &&
              text.includes(otherKind === "scanner" ? "document_versions" : "from documents")
            ) {
              paused = true;
              reachedSource();
              await release;
            }
          }),
        }).createUploadIntent({
          ...intentInput(data),
          recovery: {
            documentId: sourceId,
            expectedToken: preview!.versionToken,
            reason: "Concurrent recovery test",
          },
          recoveryApprovedBy: data.ownerId!,
        }),
      );
      try {
        await sourceLocked;
        const other = sql.begin(async (tx) => {
          const repository = createDocumentRepository({
            sql: wrap(tx, async (text) => {
              if (
                (otherKind === "replacement" &&
                  text.includes("from annual_return_cases") &&
                  text.includes("for update")) ||
                (otherKind === "scanner" && text.includes("update document_upload_intents"))
              )
                reachedOther();
            }),
          });
          return otherKind === "replacement"
            ? repository.createUploadIntent({
                ...intentInput(data),
                replacementDocumentId: sourceId,
              })
            : repository.recordScanResult(
                sourceIntentId!,
                {
                  status: "clean",
                  providerReference: "concurrency-contract",
                  verifiedChecksum: CHECKSUM_A,
                  verifiedByteSize: 4,
                },
                { verdictSource: "provider" },
              );
        });
        await Promise.race([otherLocked, new Promise((resolve) => setTimeout(resolve, 1000))]);
        releaseSource();
        const results = await Promise.allSettled([recovery, other]);
        expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
      } finally {
        releaseSource();
        await Promise.allSettled([recovery]);
        await sql`delete from timeline_events where metadata->>'sourceDocumentId'=${sourceId}`;
        if (otherKind === "replacement") await sql`delete from documents where id=${sourceId}`;
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
  it("previews an additive recovery, rejects stale preview and preserves old records with an audit link", async () => {
    const rolledBack = new Error("recovery rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const data = await fixture(tx as unknown as SqlClient);
        const repository = createDocumentRepository({ sql: tx });
        const [legacy] = await tx<
          { id: string }[]
        >`insert into documents(company_id,case_id,file_type,file_name,storage_url,upload_source,verification_status)
        values(${data.companyId},${data.caseId},'identity','legacy-recovery.pdf',${`${KEY_PREFIX}recovery`},'system','verified') returning id`;
        const preview = await repository.getDocumentRecoveryPreview(legacy.id);
        expect(preview).toMatchObject({
          documentId: legacy.id,
          availability: "metadata_only",
          action: "additive_reupload",
        });
        await expect(
          repository.createUploadIntent({
            ...intentInput(data),
            recovery: {
              documentId: legacy.id,
              expectedToken: "0".repeat(32),
              reason: "Confirmed source gap",
            },
            recoveryApprovedBy: data.ownerId!,
          }),
        ).rejects.toThrow(/changed/);
        const intent = await repository.createUploadIntent({
          ...intentInput(data),
          recovery: {
            documentId: legacy.id,
            expectedToken: preview!.versionToken,
            reason: "Confirmed source gap",
          },
          recoveryApprovedBy: data.ownerId!,
        });
        const repeated = await repository.createUploadIntent({
          ...intentInput(data),
          recovery: {
            documentId: legacy.id,
            expectedToken: preview!.versionToken,
            reason: "Confirmed source gap",
          },
          recoveryApprovedBy: data.ownerId!,
        });
        expect(repeated.id).toBe(intent.id);
        await expect(
          repository.createUploadIntent({
            ...intentInput(data, { checksum: CHECKSUM_B }),
            recovery: {
              documentId: legacy.id,
              expectedToken: preview!.versionToken,
              reason: "Different bytes",
            },
            recoveryApprovedBy: data.ownerId!,
          }),
        ).rejects.toThrow(/already pending/);
        const newDocument = await repository.finalizeUploadIntent({
          intentId: intent.id,
          uploadedBy: data.ownerId,
          source: "staff",
        });
        expect(newDocument.id).not.toBe(legacy.id);
        expect(newDocument.reviewStatus).toBe("pending");
        expect(newDocument.uploadStatus).toBe("quarantined");
        const [old] = await tx<
          { verification_status: string; storage_url: string }[]
        >`select verification_status,storage_url from documents where id=${legacy.id}`;
        expect(old).toEqual({
          verification_status: "verified",
          storage_url: `${KEY_PREFIX}recovery`,
        });
        const events = await tx<
          { event_type: string; metadata: { documentId?: string; sourceDocumentId: string } }[]
        >`select event_type,metadata from timeline_events
        where metadata->>'sourceDocumentId'=${legacy.id} order by created_at,event_type`;
        expect(events.map((event) => event.event_type)).toEqual([
          "document_recovery_received",
          "document_recovery_requested",
        ]);
        expect(
          events.find((event) => event.event_type === "document_recovery_received")?.metadata
            .documentId,
        ).toBe(newDocument.id);
        expect(await repository.getDocument(legacy.id)).toBeNull();
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });
  it("rejects a changed recovery source at finalisation without receiving another document", async () => {
    const rolledBack = new Error("changed recovery rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const data = await fixture(tx as unknown as SqlClient);
        const repository = createDocumentRepository({ sql: tx });
        const [legacy] = await tx<
          { id: string }[]
        >`insert into documents(company_id,case_id,file_type,file_name,storage_url,upload_source)
        values(${data.companyId},${data.caseId},'identity','legacy-stale.pdf',${`${KEY_PREFIX}stale`},'system') returning id`;
        const preview = await repository.getDocumentRecoveryPreview(legacy.id);
        const intent = await repository.createUploadIntent({
          ...intentInput(data),
          recovery: {
            documentId: legacy.id,
            expectedToken: preview!.versionToken,
            reason: "Confirmed gap",
          },
          recoveryApprovedBy: data.ownerId!,
        });
        await tx`update documents set file_name='source changed.pdf' where id=${legacy.id}`;
        await expect(
          repository.finalizeUploadIntent({
            intentId: intent.id,
            uploadedBy: data.ownerId,
            source: "staff",
          }),
        ).rejects.toThrow(/changed/);
        const current = await repository.getUploadIntent(intent.id);
        expect(current).toMatchObject({ status: "created", documentId: null });
        expect(
          await tx`select id from documents where storage_url=${intent.objectKey}`,
        ).toHaveLength(0);
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });
  it("keeps legacy metadata visible without making it downloadable or verified evidence", async () => {
    const rolledBack = new Error("metadata lineage rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const data = await fixture(tx as unknown as SqlClient);
        const repository = createDocumentRepository({ sql: tx });
        const [legacy] = await tx<
          { id: string }[]
        >`insert into documents(company_id,case_id,file_type,file_name,storage_url,upload_source,verification_status)
        values(${data.companyId},${data.caseId},'identity','legacy-only.pdf',${`${KEY_PREFIX}metadata-only`},'system','verified') returning id`;
        const rows = await repository.listDocuments({ companyId: data.companyId });
        const row = rows.find((item) => item.id === legacy.id);
        expect(row).toMatchObject({
          availability: "metadata_only",
          contentType: null,
          sizeBytes: null,
          checksum: null,
          uploadStatus: null,
        });
        expect(await repository.getDocument(legacy.id)).toBeNull();
        expect(documentSafetyOf(row!)).not.toBe("verified");
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });
});

describe.skipIf(!databaseUrl)("document list and detail scope parity", () => {
  it("rechecks Client membership in real Postgres for reads and writes, including revocation with the same session", async () => {
    const rolledBack = new Error("client membership rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const data = await fixture(tx as unknown as SqlClient);
        const [other] = await tx<
          { id: string }[]
        >`select id from companies where id<>${data.companyId} limit 1`;
        const authId = crypto.randomUUID();
        await tx`insert into client_company_memberships(auth_user_id,company_id) values(${authId},${data.companyId})`;
        const auth: NeonSessionAdapter = {
          getSession: async () => ({ user: { id: authId, email: "client@example.test" } }),
          signOut: async () => new Response(),
        };
        const request = new Request("https://example.test/documents");
        const repository = createDocumentRepository({ sql: tx });
        const intent = await repository.createUploadIntent(intentInput(data));
        const record = await repository.finalizeUploadIntent({
          intentId: intent.id,
          uploadedBy: null,
          source: "staff",
        });
        const client: AuthenticatedActor = {
          authUserId: authId,
          userId: null,
          teamId: null,
          role: "Client",
          active: true,
        };
        const storage = { put: vi.fn(), get: vi.fn(), head: vi.fn(), delete: vi.fn() };
        const d = {
          repository,
          storage,
          createScanner: () => {
            throw new Error("not invoked");
          },
          authorizeDocument: async (_actor: AuthenticatedActor, subject: { companyId: string }) => {
            await requireClientCompanyAccess(request, subject.companyId, {
              auth,
              sql: tx as unknown as SqlClient,
            });
          },
        };
        expect(
          (await listDocumentsForActor(client, { companyId: data.companyId }, d)).some(
            (row) => row.id === record.id,
          ),
        ).toBe(true);
        await expect(listDocumentsForActor(client, { companyId: other.id }, d)).rejects.toThrow(
          /membership/,
        );
        await expect(
          createDocumentUploadIntentForActor(
            client,
            {
              companyId: other.id,
              category: "identity",
              fileName: "forbidden.pdf",
              contentType: "application/pdf",
              sizeBytes: 4,
              checksum: CHECKSUM_A,
            },
            d,
          ),
        ).rejects.toThrow(/membership/);
        await tx`update client_company_memberships set active=false where auth_user_id=${authId}`;
        await expect(
          listDocumentsForActor(client, { companyId: data.companyId }, d),
        ).rejects.toThrow(/membership/);
        await expect(downloadDocumentForActor(client, record.id, d)).rejects.toThrow(/membership/);
        expect(storage.get).not.toHaveBeenCalled();
        expect(storage.put).not.toHaveBeenCalled();
        expect(
          await tx`select id from document_upload_intents where file_name='forbidden.pdf'`,
        ).toHaveLength(0);
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });
  it("intersects filters with same-team OR cross-team case assignments in Postgres", async () => {
    const rolledBack = new Error("document scope rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const [base] = await tx<
          { company_id: string; case_id: string; team_id: string }[]
        >`select c.id company_id,a.id case_id,c.assigned_team_id team_id from companies c join annual_return_cases a on a.company_id=c.id limit 1`;
        const [otherTeam] = await tx<
          { id: string }[]
        >`insert into teams(name) values('scope matrix') returning id`;
        const [owner] = await tx<
          { id: string }[]
        >`insert into users(name,email,role,team_id) values('scope owner',${`${crypto.randomUUID()}@example.test`},'Staff',${base.team_id}) returning id`;
        const [reviewer] = await tx<
          { id: string }[]
        >`insert into users(name,email,role,team_id) values('scope reviewer',${`${crypto.randomUUID()}@example.test`},'Manager',${base.team_id}) returning id`;
        const [unrelated] = await tx<
          { id: string }[]
        >`insert into users(name,email,role,team_id) values('scope unrelated',${`${crypto.randomUUID()}@example.test`},'Staff',${base.team_id}) returning id`;
        await tx`update companies set assigned_team_id=${otherTeam.id} where id=${base.company_id}`;
        await tx`update annual_return_cases set owner_id=${owner.id},reviewer_id=${reviewer.id} where id=${base.case_id}`;
        const repository = createDocumentRepository({ sql: tx });
        const intent = await repository.createUploadIntent(
          intentInput({
            companyId: base.company_id,
            caseId: base.case_id,
            teamId: otherTeam.id,
            ownerId: owner.id,
          }),
        );
        const document = await repository.finalizeUploadIntent({
          intentId: intent.id,
          uploadedBy: null,
          source: "staff",
        });
        const subject = await repository.getDocumentAccessSubject(document.id);
        expect(subject).not.toBeNull();
        const baseActor: AuthenticatedActor = {
          authUserId: "scope-actor",
          userId: owner.id,
          teamId: base.team_id,
          role: "Staff",
          active: true,
        };
        const matrix: Array<[AuthenticatedActor, boolean]> = [
          [baseActor, true],
          [{ ...baseActor, userId: reviewer.id, role: "Manager" }, true],
          [{ ...baseActor, userId: unrelated.id }, false],
          [{ ...baseActor, userId: unrelated.id, teamId: otherTeam.id }, true],
          [{ ...baseActor, role: "Admin", teamId: null }, true],
        ];
        for (const [actor, expected] of matrix) {
          const scope = documentFiltersForActor(actor);
          const listed = await repository.listDocuments({ ...scope, companyId: base.company_id });
          expect(listed.some((row) => row.id === document.id)).toBe(expected);
          expect(isDocumentVisibleToStaffActor(actor, subject!)).toBe(expected);
          expect(
            await repository.listDocuments({ ...scope, caseId: crypto.randomUUID() }),
          ).toHaveLength(0);
        }
        for (const actor of [
          { ...baseActor, active: false },
          { ...baseActor, teamId: null },
          { ...baseActor, userId: null },
        ]) {
          expect(() => documentFiltersForActor(actor)).toThrow(/Forbidden/);
          expect(isDocumentVisibleToStaffActor(actor, subject!)).toBe(false);
        }
        const [caseLess] = await tx<
          { id: string }[]
        >`insert into documents(company_id,file_type,file_name,storage_url,upload_source)
        values(${base.company_id},'identity','case-less.pdf',${`${KEY_PREFIX}case-less`},'system') returning id`;
        const [wrongCase] = await tx<
          { id: string }[]
        >`select id from annual_return_cases where company_id<>${base.company_id} limit 1`;
        const [malformed] = await tx<
          { id: string }[]
        >`insert into documents(company_id,case_id,file_type,file_name,storage_url,upload_source)
        values(${base.company_id},${wrongCase.id},'identity','cross-company.pdf',${`${KEY_PREFIX}cross-company`},'system') returning id`;
        for (const id of [caseLess.id, malformed.id]) {
          const scoped = await repository.getDocumentAccessSubject(id);
          expect(isDocumentVisibleToStaffActor(baseActor, scoped!)).toBe(false);
          expect(
            (await repository.listDocuments(documentFiltersForActor(baseActor))).some(
              (row) => row.id === id,
            ),
          ).toBe(false);
        }
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });
});

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

/**
 * Checklist rows this file mutated, with the state they were ACTUALLY in.
 *
 * This used to be a Set, and teardown reset every touched row to
 * status 'Missing', received_at null, document_id null -- a hardcoded guess,
 * not a restore, while the comment claimed the seed row was "left as found".
 * The seeded row this file picks is 'Verified' with a document and a
 * verified_at, so every run silently rewrote seeded data that later tests read,
 * and never touched verified_at at all. Snapshot first, restore what was there.
 */
type ChecklistSnapshot = {
  status: string;
  received_at: string | Date | null;
  verified_at: string | Date | null;
  document_id: string | null;
};
const touchedChecklistItems = new Map<string, ChecklistSnapshot>();

/** Read the row before touching it. Call this instead of recording the id. */
async function claimChecklistItem(sql: SqlClient, itemId: string): Promise<void> {
  if (touchedChecklistItems.has(itemId)) return;
  const rows = await sql<ChecklistSnapshot[]>`
    select status, received_at, verified_at, document_id
    from annual_return_checklist_items where id = ${itemId}`;
  if (rows[0]) touchedChecklistItems.set(itemId, rows[0]);
}

async function cleanup(sql: SqlClient): Promise<void> {
  for (const [itemId, snapshot] of touchedChecklistItems) {
    await sql`
      update annual_return_checklist_items
      set status = ${snapshot.status},
          received_at = ${snapshot.received_at},
          verified_at = ${snapshot.verified_at},
          document_id = ${snapshot.document_id}
      where id = ${itemId}`;
  }
  touchedChecklistItems.clear();
  // Teardown has to run innermost-first, and getting it wrong failed all twenty
  // tests in this file rather than one. The graph, as it actually is:
  //   document_versions   -> document_upload_intents  (restrict)
  //   document_versions   -> documents                (cascade)
  //   document_versions   -> document_versions        (restrict, supersession)
  //   document_scan_jobs  -> document_upload_intents  (restrict)
  //   document_upload_intents -> documents            (restrict)
  // So the versions and jobs go first, then the intents, then the documents --
  // and the document ids have to be read before the intents are gone, because
  // the intents are what name them.
  const owned = await sql<{ document_id: string }[]>`
    select document_id from document_upload_intents
    where object_key like ${KEY_PREFIX + "%"} and document_id is not null`;

  // Supersession points version 1 at version 2 with restrict, so a single
  // delete covering both rows would refuse itself.
  await sql`
    update document_versions set superseded_by_version_id = null
    where intent_id in (
      select id from document_upload_intents where object_key like ${KEY_PREFIX + "%"}
    )`;
  await sql`
    delete from document_versions
    where intent_id in (
      select id from document_upload_intents where object_key like ${KEY_PREFIX + "%"}
    )`;
  await sql`
    delete from document_scan_jobs
    where intent_id in (
      select id from document_upload_intents where object_key like ${KEY_PREFIX + "%"}
    )`;
  await sql`delete from document_upload_intents where object_key like ${KEY_PREFIX + "%"}`;

  if (owned.length > 0) {
    // string_to_array rather than an array parameter: postgres.js takes an
    // array's element type from its FIRST element, so it sends the value as
    // plain text and the cast then fails on a malformed array literal. A uuid
    // never contains a comma, so joining is safe here.
    const ids = owned.map((row) => row.document_id).join(",");
    await sql`
      delete from requirement_evidence_links
      where document_id = any(string_to_array(${ids}, ',')::uuid[])`;
    await sql`delete from documents where id = any(string_to_array(${ids}, ',')::uuid[])`;
  }
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
        {
          status: "clean",
          providerReference: "integration-clean",
          verifiedChecksum: CHECKSUM_A,
          verifiedByteSize: 4,
        },
        { verdictSource: "provider", expectedChecksum: CHECKSUM_A },
      );
      const verified = await repository.reviewDocument({
        documentId: firstDocument.id,
        expectedVersionId: firstDocument.currentVersionId!,
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

  /**
   * The failure the reclaim branch does not cover.
   *
   * claimDue is gated on `attempt_count < max_attempts` and increments the count
   * when it claims, and the reclaim sits inside that gate. So a job claimed on
   * its FINAL attempt whose Worker then died stays at status='processing' with
   * attempt_count = max_attempts, and claimDue will never take it again: the
   * document silently never gets a safety verdict, and so can never be approved.
   * notification_outbox already had this counterpart; the two document queues
   * copied the claim-and-reclaim pattern without it.
   *
   * Asserted against a real Postgres because the local suite cannot see SQL at
   * all -- which is how the pattern came to be copied incompletely.
   */
  it(
    "finalises a scan job stranded on its final attempt, and leaves a live one alone",
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

      // A worker that died on the last attempt, long enough ago to be past the
      // visibility timeout.
      await sql`
        update document_scan_jobs
        set attempt_count = max_attempts, updated_at = now() - interval '2 hours'
        where id = ${mine!.id}`;

      // A second row, claimed just now with attempts left: it is still working,
      // and the sweep must not touch it.
      const [live] = await sql<{ id: string }[]>`
        select id from document_scan_jobs
        where status = 'processing' and attempt_count < max_attempts
          and id <> ${mine!.id}
        limit 1`;

      const swept = await jobs.failStranded(now);
      expect(swept.failed).toBeGreaterThanOrEqual(1);

      const [after] = await sql<{ status: string; last_error_code: string | null }[]>`
        select status, last_error_code from document_scan_jobs where id = ${mine!.id}`;
      expect(after.status).toBe("failed");
      expect(after.last_error_code).toBe("scan_stranded");

      // Terminal, not retried: the attempt budget is spent.
      const reclaimed = await jobs.claimDue(new Date().toISOString(), 100);
      expect(reclaimed.some((job) => job.id === mine!.id)).toBe(false);

      if (live) {
        const [untouched] = await sql<{ status: string }[]>`
          select status from document_scan_jobs where id = ${live.id}`;
        expect(untouched.status).toBe("processing");
      }
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
      await claimChecklistItem(sql, itemId);
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
      await claimChecklistItem(sql, itemId);
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
          verifiedChecksum: CHECKSUM_A,
          verifiedByteSize: 4,
        },
        { verdictSource: "provider" },
      );

      const versions = await sql<VersionRow[]>`
        select * from document_versions where document_id = ${document.id}`;
      expect(versions[0].verified_checksum_sha256).toBe(CHECKSUM_A);
      expect(versions[0].verified_at).not.toBeNull();
      // Retain the original claim. A mismatched identity is refused separately.
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
        {
          status: "clean",
          providerReference: "first",
          verifiedChecksum: CHECKSUM_A,
          verifiedByteSize: 4,
        },
        { verdictSource: "provider" },
      );
      // A re-scan of an already-released file, which is the one path that may
      // land a second verdict. It must not silently move the bytes underneath a
      // decision already recorded against them.
      await expect(
        repository.recordScanResult(
          intent.id,
          { status: "clean", providerReference: "second", verifiedChecksum: CHECKSUM_C },
          { verdictSource: "provider", allowStatuses: ["available"] },
        ),
      ).rejects.toThrow(/checksum/i);

      const versions = await sql<VersionRow[]>`
        select verified_checksum_sha256 from document_versions
        where document_id = ${document.id}`;
      expect(versions[0].verified_checksum_sha256).toBe(CHECKSUM_A);
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

  it(
    "stores an extraction and replaces it on a re-run",
    async () => {
      const sql = sqlForTests();
      const repository = createDocumentRepository({ sql });
      const analysis = createDocumentAnalysisRepository({ sql });
      const data = await fixture(sql);

      const intent = await repository.createUploadIntent(intentInput(data));
      const document = await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      });
      const [version] = await sql<{ id: string }[]>`
        select id from document_versions where document_id = ${document.id}`;

      await analysis.upsertText(version.id, {
        method: "none",
        pageCount: 2,
        extractorVersion: "1",
      });
      await analysis.upsertText(version.id, {
        method: "text-layer",
        text: "周年申報表",
        pageCount: 3,
        truncated: true,
        extractorVersion: "1",
      });

      const rows = await sql<
        {
          extracted_text: string | null;
          page_count: number | null;
          extraction_method: string;
          truncated: boolean;
          extractor_version: string;
        }[]
      >`
        select extracted_text, page_count, extraction_method, truncated, extractor_version
        from document_version_texts where document_version_id = ${version.id}`;

      expect(rows).toEqual([
        {
          extracted_text: "周年申報表",
          page_count: 3,
          extraction_method: "text-layer",
          truncated: true,
          extractor_version: "1",
        },
      ]);

      // And what the analysis pass reads back is the value just written.
      const subject = await analysis.loadForAnalysis(version.id);
      expect(subject?.knownPageCount).toBe(3);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
