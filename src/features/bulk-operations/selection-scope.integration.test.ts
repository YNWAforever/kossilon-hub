import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import { createProductionFollowUpRepository } from "@/features/annual-return/follow-up-repository";
import { listProductionFollowUpDraftsForActor } from "@/features/annual-return/follow-up-server-fns";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import { createDocumentRepository } from "@/features/documents/repository";
import { createBulkOperationsRepository } from "./repository";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("R18.1 real PostgreSQL draft selection", () => {
  it("draft_scope_selects_two_of_twenty, rejects explicit scope expansion and freezes membership", async () => {
    const sql = createSqlClient(url!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const teamA = randomUUID(),
            teamB = randomUUID(),
            ownerA = randomUUID(),
            ownerB = randomUUID();
          const actor: AuthenticatedActor = {
            userId: ownerA,
            authUserId: `isolated-${ownerA}`,
            role: "Manager",
            teamId: teamA,
            active: true,
          };
          await tx`insert into teams(id,name) values (${teamA},'R18.1 isolated A'),(${teamB},'R18.1 isolated B')`;
          await tx`insert into users(id,name,email,role,team_id) values (${ownerA},'R18.1 manager',${ownerA + "@example.test"},'Manager',${teamA}),(${ownerB},'R18.1 other manager',${ownerB + "@example.test"},'Manager',${teamB})`;
          await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id) values (${ownerA},${actor.authUserId},'Manager',${teamA}),(${ownerB},${"isolated-" + ownerB},'Manager',${teamB})`;
          const ids = Array.from({ length: 21 }, () => randomUUID()),
            companies = ids.map(() => randomUUID());
          await tx`insert into companies ${tx(companies.map((id, index) => ({ id, company_name: "R18.1 isolated " + index, cr_number: id, br_number: id, incorporation_date: "2020-01-01", annual_return_basis_date: "2026-10-01", registered_office: "Isolated", company_secretary: "Isolated", status: "active", data_origin: "client", assigned_owner_id: index === 20 ? ownerB : ownerA, assigned_team_id: index === 20 ? teamB : teamA })))}`;
          await tx`insert into annual_return_cases ${tx(ids.map((id, index) => ({ id, company_id: companies[index], return_year: 2026, made_up_date: "2026-10-01", filing_due_date: "2026-11-12", owner_id: index === 20 ? ownerB : ownerA, current_status: "Upcoming", risk_level: "green" })))}`;
          await tx`insert into annual_return_checklist_items ${tx(ids.map((id, index) => ({ case_id: id, item_label: "R18.1 isolated evidence", required: true, status: index < 2 || index === 20 ? "Missing" : "Received", due_date: "2026-11-12" })))}`;
          // An assigned owner/reviewer can act on an individual foreign-team case,
          // but the AR list and bulk selection retain the existing team predicate.
          await tx`update annual_return_cases set owner_id=${ownerA},reviewer_id=${ownerA} where id=${ids[20]}`;
          const docs = createDocumentRepository({ sql: tx });
          for (const index of [0, 1, 2]) {
            const checksum = "a".repeat(64);
            const intent = await docs.createUploadIntent({
              companyId: companies[index],
              caseId: ids[index],
              requestedByAuthUserId: actor.authUserId,
              category: "registry",
              fileName: "R18 isolated.pdf",
              contentType: "application/pdf",
              expectedSizeBytes: 4,
              checksum,
              objectKey: `isolated/${randomUUID()}`,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            });
            const doc = await docs.finalizeUploadIntent({
              intentId: intent.id,
              uploadedBy: ownerA,
              source: "staff",
            });
            // Synthetic SQL provider contract only; never evidence of native scan/R2 health.
            if (index !== 2)
              await docs.recordScanResult(
                intent.id,
                {
                  status: "clean",
                  providerReference: "synthetic-local",
                  verifiedChecksum: checksum,
                  verifiedByteSize: 4,
                },
                { verdictSource: "provider" },
              );
            const currentVersion = (await docs.getDocument(doc.id))!.currentVersionId!;
            await tx`update documents set verification_status='rejected',reviewed_document_version_id=${currentVersion} where id=${doc.id}`;
            await tx`update annual_return_checklist_items set document_id=${doc.id},status=${index === 0 ? "Missing" : "Received"} where case_id=${ids[index]}`;
          }
          const drafts = await listProductionFollowUpDraftsForActor(actor, {
            annualReturnRepository: createAnnualReturnRepository({ sql: tx }),
            followUpRepository: createProductionFollowUpRepository({ sql: tx }),
            whatsAppRepository: {} as WhatsAppRepository,
          });
          expect([...new Set(drafts.map((d) => d.caseId))].sort()).toEqual(ids.slice(0, 2).sort());
          expect(drafts.filter((d) => d.caseId === ids[0])).toHaveLength(2);
          expect(drafts.find((d) => d.caseId === ids[1])?.source).toBe("document-review");
          await expect(
            listProductionFollowUpDraftsForActor(
              { ...actor, teamId: null },
              {
                annualReturnRepository: createAnnualReturnRepository({ sql: tx }),
                followUpRepository: createProductionFollowUpRepository({ sql: tx }),
                whatsAppRepository: {} as WhatsAppRepository,
              },
            ),
          ).rejects.toThrow(/Forbidden/);
          // Real nested savepoints let job creation exercise SQL while the entire fixture rolls back.
          const transactionalSql = Object.assign(tx, { begin: tx.savepoint.bind(tx) });
          const repo = createBulkOperationsRepository({
            sql: transactionalSql as unknown as typeof sql,
          });
          const filters = { selectionContext: "whatsapp_draft_cases" as const };
          const snapshot = await repo.createSnapshot(actor, {
            resource: "annual_return_case",
            filters,
          });
          expect(snapshot.count).toBe(2);
          await expect(
            repo.createSnapshot(actor, {
              resource: "annual_return_case",
              filters: { selectionContext: "unknown" },
            }),
          ).rejects.toThrow();
          await expect(
            repo.createSnapshot(actor, { resource: "document", filters }),
          ).rejects.toThrow(/Unsupported/);
          const membership = await repo.snapshotMembership(actor, {
            snapshotId: snapshot.snapshotId,
            ids,
          });
          expect(membership.ids.sort()).toEqual(ids.slice(0, 2).sort());
          const preview = await repo.previewAction(actor, {
            resource: "annual_return_case",
            selection: { mode: "explicit_ids", ids: [ids[0], ids[1], ids[2], ids[20]] },
            filters,
            action: { kind: "follow_up_draft" },
          });
          expect(preview.count).toBe(4);
          expect(preview.reasons.forbidden).toBe(2);
          await tx`update annual_return_checklist_items set status='Missing' where case_id=${ids[2]}`;
          const frozen = await repo.previewAction(actor, {
            resource: "annual_return_case",
            selection: {
              mode: "filtered_snapshot",
              snapshotId: snapshot.snapshotId,
              excludedIds: [],
            },
            action: { kind: "follow_up_draft" },
          });
          expect(frozen.count).toBe(2);
          const key = randomUUID();
          const first = await repo.execute(actor, {
            previewId: frozen.previewId,
            idempotencyKey: key,
          });
          expect(
            await repo.execute(actor, { previewId: frozen.previewId, idempotencyKey: key }),
          ).toMatchObject({ jobId: first.jobId });
          await tx`update users set active=false where id=${ownerA}`;
          await expect(
            repo.createSnapshot(actor, { resource: "annual_return_case", filters }),
          ).rejects.toThrow(/Forbidden/);
          throw new Error("rollback R18.1 isolated fixture");
        }),
      ).rejects.toThrow("rollback R18.1 isolated fixture");
    } finally {
      await sql.end();
    }
  });
});
