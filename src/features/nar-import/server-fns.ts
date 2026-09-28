import { entityIdSchema } from "@/features/runtime/entity-id";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import { readNarSheet, type NarSheetReadResult } from "./mapping";
import type { NarImportRepository } from "./repository";
import { readXlsxWorkbook, XlsxFormatError } from "./xlsx/workbook";

/**
 * The import's request-facing edge.
 *
 * Two rules the rest of the feature depends on are enforced here. The workbook is
 * parsed on the server, never in the browser, because it is an untrusted file
 * from another firm's system and the parser's refusals (macros, external links,
 * encrypted workbooks, zip bombs) are only worth anything if they run somewhere a
 * caller cannot skip. And staging never touches `companies`, `annual_return_cases`
 * or `payments` -- an import that cannot create a company is an import that
 * cannot invent a CR number.
 */

/** Bounded before any allocation: the base64 body is decoded whole. */
const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;
const MAX_WORKBOOK_BASE64_LENGTH = Math.ceil(MAX_WORKBOOK_BYTES / 3) * 4;

export type NarImportDependencies = {
  repository: NarImportRepository;
};

const loadDefaultContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireActor }, { createNarImportRepository }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
  ]);
  const actor = await requireActor(getRequest());
  return { actor, dependencies: { repository: createNarImportRepository() } };
});

async function withContext<T>(
  handler: (actor: AuthenticatedActor, dependencies: NarImportDependencies) => Promise<T>,
): Promise<T> {
  const { actor, dependencies } = await loadDefaultContext();
  try {
    return await handler(actor, dependencies);
  } finally {
    await dependencies.repository.close();
  }
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Hex(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(body).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Importing rewrites how a whole month of cases is understood, so it is not an
 * ordinary staff action -- the same reasoning that makes `cleanupExpiredUploads`
 * Admin-only, being the other operation that reaches across every company at once.
 */
function assertImportAuthority(actor: AuthenticatedActor): AuthenticatedActor {
  const staff = assertStaffAccess(actor);
  // Admin only, which is what the reasoning above always argued for and what the
  // code did not do. A Manager passed this check and then read the whole batch:
  // getNarImportBatchReview applies no team scope, and every staged row carries
  // `raw` -- the spreadsheet cells verbatim -- for every company in the workbook,
  // including companies belonging to other teams. Scoping the read by team was
  // the alternative and it is incoherent here: a batch spans teams by nature, so
  // a team-filtered review would hide rows from the very person who has to
  // approve the import.
  if (staff.role !== "Admin") {
    throw new Error("Forbidden: Admin access is required to import a workbook.");
  }
  return staff;
}

export async function approveNarImportForActor(
  actor: AuthenticatedActor,
  input: { previewId: string; previewHash: string },
  repository: ReturnType<typeof import("./apply-repository").createNarImportApplyRepository>,
) {
  assertImportAuthority(actor);
  return repository.approve(actor, input);
}
export async function applyNarImportForActor(
  actor: AuthenticatedActor,
  input: { approvalId: string; idempotencyKey: string },
  repository: ReturnType<
    typeof import("@/features/bulk-operations/repository").createBulkOperationRepository
  >,
) {
  assertImportAuthority(actor);
  return repository.commitImportApproval(actor, input);
}

export type StageNarImportInput = {
  fileName: string;
  bodyBase64: string;
  sheetName?: string;
  returnYear: number;
};

export async function stageNarImportForActor(
  actor: AuthenticatedActor,
  input: StageNarImportInput,
  dependencies: NarImportDependencies,
) {
  const staff = assertImportAuthority(actor);
  const bytes = bytesFromBase64(input.bodyBase64);
  if (bytes.byteLength === 0) throw new Error("The uploaded workbook is empty.");

  let workbook;
  try {
    workbook = await readXlsxWorkbook(bytes);
  } catch (error) {
    // The parser's refusals are the useful part of its output -- "this workbook
    // contains macros" tells an operator what to do, where a generic failure
    // does not -- so they are surfaced rather than flattened.
    if (error instanceof XlsxFormatError) throw new Error(error.message);
    throw error;
  }

  const sheet = input.sheetName ? workbook.sheet(input.sheetName) : workbook.sheets[0];
  if (!sheet) {
    throw new Error(
      `Sheet ${input.sheetName} was not found. This workbook has: ${workbook.sheets
        .map((candidate) => candidate.name)
        .join(", ")}.`,
    );
  }

  const read: NarSheetReadResult = readNarSheet(sheet, workbook.date1904);
  if (read.headerRowNumber === -1) {
    throw new Error(read.issues[0]?.message ?? "The sheet has no recognisable header row.");
  }

  const result = await dependencies.repository.stageBatch({
    sourceFileName: input.fileName,
    sourceSha256: await sha256Hex(bytes),
    sourceSizeBytes: bytes.byteLength,
    parserVersion: workbook.parserVersion,
    returnYear: input.returnYear,
    createdBy: staff.userId,
    read,
  });

  return {
    batch: result.batch,
    reused: result.reused,
    // Reported so the preview can say what was left out rather than only what
    // was taken in: a row with content but no client id is skipped, and a staff
    // member should see that it was.
    skippedRowNumbers: read.skippedRowNumbers,
    sheetIssues: read.issues,
  };
}

export async function getNarImportBatchReviewForActor(
  actor: AuthenticatedActor,
  input: { batchId: string; cursor?: number; limit?: number },
  dependencies: NarImportDependencies,
) {
  assertImportAuthority(actor);
  const batch = await dependencies.repository.getBatch(input.batchId);
  if (!batch) throw new Error("Import batch not found.");
  const [page, counts] = await Promise.all([
    dependencies.repository.listRowsPage(input.batchId, input.cursor ?? null, input.limit ?? 50),
    dependencies.repository.countByDisposition(input.batchId),
  ]);
  return { batch, rows: page.items, nextCursor: page.nextCursor, counts };
}

export async function getNarImportPreviewPageForActor(
  actor: AuthenticatedActor,
  input: { previewId: string; offset: number; limit: number },
  dependencies: NarImportDependencies,
) {
  const staff = assertImportAuthority(actor);
  if (!staff.userId) throw new Error("Forbidden: active staff identity is required.");
  return dependencies.repository.listPreviewPage({ ...input, actorId: staff.userId });
}

export async function searchImportCompaniesForActor(
  actor: AuthenticatedActor,
  input: { q: string; cursor: string | null; limit: number },
  dependencies: NarImportDependencies,
) {
  assertImportAuthority(actor);
  return dependencies.repository.searchCompanies(input);
}

export async function revalidateNarImportForActor(
  actor: AuthenticatedActor,
  input: { batchId: string; expectedRevision: number; returnYear?: number },
  dependencies: NarImportDependencies,
) {
  const staff = assertImportAuthority(actor);
  if (!staff.userId) throw new Error("Forbidden: active staff identity is required.");
  return dependencies.repository.revalidate(
    input.batchId,
    staff.userId,
    input.expectedRevision,
    input.returnYear,
  );
}

export async function mapNarImportCompanyForActor(
  actor: AuthenticatedActor,
  input: { externalClientId: string; companyId: string },
  dependencies: NarImportDependencies,
) {
  const staff = assertImportAuthority(actor);
  await dependencies.repository.mapExternalReference({
    externalClientId: input.externalClientId,
    companyId: input.companyId,
    mappedBy: staff.userId,
  });
  return { mapped: true as const };
}

const stageSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    bodyBase64: z.string().min(1).max(MAX_WORKBOOK_BASE64_LENGTH),
    sheetName: z.string().trim().min(1).max(120).optional(),
    // Chosen by the staff member, never read out of the sheet name. The supplied
    // sheet is called "8.2025" and is historical; inferring a period from that
    // would silently activate the wrong year's cases.
    returnYear: z.number().int().min(1900).max(2100),
  })
  .strict();

export const stageNarImportBatch = createServerFn({ method: "POST" })
  .validator(stageSchema)
  .handler(({ data }) =>
    withContext((actor, dependencies) => stageNarImportForActor(actor, data, dependencies)),
  );

export const listNarImportBatches = createServerFn({ method: "GET" }).handler(() =>
  withContext(async (actor, dependencies) => {
    assertImportAuthority(actor);
    return dependencies.repository.listBatches();
  }),
);

export const getNarImportBatchReview = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        batchId: entityIdSchema,
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
  )
  .handler(({ data }) =>
    withContext((actor, dependencies) =>
      getNarImportBatchReviewForActor(actor, data, dependencies),
    ),
  );

export const getNarImportPreviewPage = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        previewId: entityIdSchema,
        offset: z.number().int().min(0),
        limit: z.number().int().min(1).max(50),
      })
      .strict(),
  )
  .handler(({ data }) =>
    withContext((actor, dependencies) =>
      getNarImportPreviewPageForActor(actor, data, dependencies),
    ),
  );

export const searchImportCompanies = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        q: z.string().trim().max(120),
        cursor: entityIdSchema.nullable(),
        limit: z.number().int().min(1).max(50),
      })
      .strict(),
  )
  .handler(({ data }) =>
    withContext((actor, dependencies) => searchImportCompaniesForActor(actor, data, dependencies)),
  );

export const revalidateNarImport = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        batchId: entityIdSchema,
        expectedRevision: z.number().int().positive(),
        returnYear: z.number().int().min(1900).max(2100).optional(),
      })
      .strict(),
  )
  .handler(({ data }) =>
    withContext((actor, dependencies) => revalidateNarImportForActor(actor, data, dependencies)),
  );

export const mapNarImportCompany = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        externalClientId: z.string().trim().min(1).max(120),
        companyId: entityIdSchema,
      })
      .strict(),
  )
  .handler(({ data }) =>
    withContext((actor, dependencies) => mapNarImportCompanyForActor(actor, data, dependencies)),
  );

const approveImportSchema = z
  .object({
    previewId: entityIdSchema,
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const applyImportSchema = z
  .object({
    approvalId: entityIdSchema,
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict();
const loadImportApplyContext = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { requireStaffActor },
    { createNarImportApplyRepository },
    { createBulkOperationRepository },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./apply-repository"),
    import("@/features/bulk-operations/repository"),
  ]);
  return {
    actor: await requireStaffActor(getRequest()),
    createApplyRepository: createNarImportApplyRepository,
    createBulkRepository: createBulkOperationRepository,
  };
});
export const approveNarImport = createServerFn({ method: "POST" })
  .validator(approveImportSchema)
  .handler(async ({ data }) => {
    const context = await loadImportApplyContext();
    const repository = context.createApplyRepository();
    try {
      return await approveNarImportForActor(context.actor, data, repository);
    } finally {
      await repository.close();
    }
  });
export const applyNarImport = createServerFn({ method: "POST" })
  .validator(applyImportSchema)
  .handler(async ({ data }) => {
    const context = await loadImportApplyContext();
    const repository = context.createBulkRepository();
    try {
      return await applyNarImportForActor(context.actor, data, repository);
    } finally {
      await repository.close();
    }
  });
