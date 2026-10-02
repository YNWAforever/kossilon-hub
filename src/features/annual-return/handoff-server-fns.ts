import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { HandoffRepository } from "./handoff-repository";
import type { ArchiveEvidence } from "./package-archive";

const uuid = z.string().uuid(),
  version = z.string().min(1).max(200),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const handoffCommandSchema = z.discriminatedUnion("command", [
  z
    .object({
      command: z.literal("approve"),
      caseId: uuid,
      expectedVersion: version,
      manifestSha256: hash,
    })
    .strict(),
  z
    .object({
      command: z.literal("manual_submission"),
      handoffId: uuid,
      expectedVersion: version,
      occurredAt: z.string().datetime(),
      reference: z.string().trim().min(1).max(200),
      note: z.string().trim().min(1).max(1000),
      evidenceDocumentId: uuid.nullable(),
      evidenceVersionId: uuid.nullable(),
    })
    .strict(),
  z
    .object({
      command: z.literal("return"),
      handoffId: uuid,
      idempotencyKey: uuid,
      returnedManifestSha256: hash,
      outcome: z.enum(["accepted", "rejected", "partial", "unmatched"]),
      reference: z.string().trim().min(1).max(200),
      detail: z.string().trim().min(1).max(2000),
      documentId: uuid.nullable(),
      documentVersionId: uuid.nullable(),
    })
    .strict(),
  z
    .object({
      command: z.literal("reconcile"),
      returnId: uuid,
      note: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      command: z.literal("withdraw"),
      handoffId: uuid,
      expectedVersion: version,
      note: z.string().trim().min(1).max(1000),
    })
    .strict(),
]);
const exportSchema = z.object({ handoffId: uuid, expectedVersion: version }).strict();
function staff(actor: AuthenticatedActor) {
  assertStaffAccess(actor);
  if (!actor.userId) throw new Error("Forbidden: staff database identity required.");
}
export function runHandoffCommandForActor(
  actor: AuthenticatedActor,
  input: unknown,
  repo: HandoffRepository,
) {
  staff(actor);
  const { command, ...data } = handoffCommandSchema.parse(input);
  switch (command) {
    case "approve":
      return repo.approve(actor, data as Parameters<HandoffRepository["approve"]>[1]);
    case "manual_submission":
      return repo.recordManualSubmission(
        actor,
        data as Parameters<HandoffRepository["recordManualSubmission"]>[1],
      );
    case "return":
      return repo.recordReturn(actor, data as Parameters<HandoffRepository["recordReturn"]>[1]);
    case "reconcile":
      return repo.reconcile(actor, data as Parameters<HandoffRepository["reconcile"]>[1]);
    case "withdraw":
      return repo.withdraw(actor, data as Parameters<HandoffRepository["withdraw"]>[1]);
  }
}
export async function exportApprovedHandoffForActor(
  actor: AuthenticatedActor,
  input: z.input<typeof exportSchema>,
  dependencies: {
    repository: Pick<HandoffRepository, "approvedExport" | "recordExport">;
    readVersion: (
      ref: ArchiveEvidence,
    ) => Promise<{ body: ArrayBuffer; checksum: string; documentId: string; versionId: string }>;
  },
) {
  staff(actor);
  const data = exportSchema.parse(input),
    approved = await dependencies.repository.approvedExport(actor, data);
  const { buildApprovedPackageArchive } = await import("./package-archive");
  const zip = await buildApprovedPackageArchive(approved.manifestPayload, dependencies.readVersion);
  // Re-authorizes and checks the whole current evidence snapshot after storage IO.
  const fact = await dependencies.repository.recordExport(actor, data);
  return {
    fileName: `approved-package-${approved.id}.zip`,
    contentType: "application/zip",
    zip,
    manifestSha256: approved.manifestSha256,
    fact,
  };
}
export function assertHandoffRuntimeMode(mode: string) {
  if (mode !== "live") throw new Error("Demo handoffs are read-only.");
}
const context = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { requireStaffActor },
    { currentProviderMode },
    { createHandoffRepository },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("@/server/provider-mode"),
    import("./handoff-repository"),
  ]);
  assertHandoffRuntimeMode(currentProviderMode());
  return { actor: await requireStaffActor(getRequest()), repository: createHandoffRepository() };
});
export const getCaseHandoffs = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: uuid }).strict())
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    const [preview, workflow] = await Promise.all([
      repository.preview(actor, data.caseId),
      repository.list(actor, data.caseId),
    ]);
    return { preview, ...workflow };
  });
export const runHandoffCommand = createServerFn({ method: "POST" })
  .validator(handoffCommandSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return runHandoffCommandForActor(actor, data, repository);
  });
export const buildHandoffExportForRequest = createServerOnlyFn(
  async (request: Request, data: z.input<typeof exportSchema>) => {
    const [
      { createHandoffRepository },
      { createDocumentContextForRequest, downloadDocumentForActor },
      { currentProviderMode },
      { getSqlClient },
    ] = await Promise.all([
      import("./handoff-repository"),
      import("@/features/documents/server-fns"),
      import("@/server/provider-mode"),
      import("@/server/db/client"),
    ]);
    assertHandoffRuntimeMode(currentProviderMode());
    const documents = await createDocumentContextForRequest(request),
      actor = documents.actor,
      repository = createHandoffRepository();
    staff(actor);
    return exportApprovedHandoffForActor(actor, data, {
      repository,
      readVersion: async (ref) => {
        const [versionRow] = await getSqlClient()<
          { document_id: string }[]
        >`select document_id from document_versions where id=${ref.versionId} and superseded_by_version_id is null`;
        if (!versionRow || (ref.documentId && versionRow.document_id !== ref.documentId))
          throw new Error("Approved document version changed.");
        const { document, body } = await downloadDocumentForActor(
          actor,
          versionRow.document_id,
          documents.dependencies,
          ref.versionId,
        );
        if (
          document.reviewStatus !== "verified" ||
          document.reviewedVersionId !== ref.versionId ||
          !document.verifiedChecksum
        )
          throw new Error("Approved document needs current-version human review.");
        return {
          body,
          checksum: document.verifiedChecksum,
          documentId: document.id,
          versionId: ref.versionId,
        };
      },
    });
  },
);
