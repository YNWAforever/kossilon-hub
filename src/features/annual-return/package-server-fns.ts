import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getManualSubmissionForActor,
  listManualSubmissionProofsForActor,
  manualSubmissionInputSchema,
  recordManualSubmissionForActor,
} from "./submission-service";
import { entityIdSchema } from "@/features/runtime/entity-id";
import {
  getReturnIntakesForActor,
  ingestReturnForActor,
  reconcileReturnForActor,
  returnDecisionSchema,
  returnIntakeSchema,
} from "./return-service";
import {
  approvePackageForActor,
  downloadApprovedPackageForActor,
  getPackageForActor,
  preparePackageForActor,
} from "./package-service";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const revisionSchema = z.number().int().nonnegative();

const loadPackageContext = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { getCurrentAnnualReturnActor },
    { createDocumentStorageForProviderMode },
    { currentProviderMode },
    { getDocumentsBucketBinding },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("./session"),
    import("@/features/documents/server-fns"),
    import("@/server/provider-mode"),
    import("@/server/runtime-env"),
  ]);
  const mode = currentProviderMode();
  return {
    actor: await getCurrentAnnualReturnActor(getRequest()),
    storage: createDocumentStorageForProviderMode(
      mode,
      mode === "live" ? getDocumentsBucketBinding() : undefined,
    ),
  };
});

export const getAnnualReturnPackage = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: entityIdSchema }).strict())
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    return getPackageForActor(actor, data.caseId, { storage });
  });

export const prepareAnnualReturnPackage = createServerFn({ method: "POST" })
  .validator(z.object({ caseId: entityIdSchema, expectedRevision: revisionSchema }).strict())
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    return preparePackageForActor(actor, data, { storage });
  });

export const approveAnnualReturnPackage = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        packageId: entityIdSchema,
        manifestHash: hashSchema,
        expectedRevision: revisionSchema.min(1),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    return approvePackageForActor(actor, data, { storage });
  });

export const downloadAnnualReturnPackage = createServerFn({ method: "GET" })
  .validator(z.object({ packageId: entityIdSchema }).strict())
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    const file = await downloadApprovedPackageForActor(actor, data.packageId, { storage });
    return new Response(file.body, {
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.fileName}"`,
        "cache-control": "private, no-store",
        "x-content-sha256": file.checksum,
      },
    });
  });

export const getAnnualReturnSubmission = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: entityIdSchema }).strict())
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    return getManualSubmissionForActor(actor, data.caseId, { storage });
  });

export const listAnnualReturnSubmissionProofs = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: entityIdSchema }).strict())
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    return listManualSubmissionProofsForActor(actor, data.caseId, { storage });
  });

export const recordAnnualReturnSubmission = createServerFn({ method: "POST" })
  .validator(manualSubmissionInputSchema)
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    return recordManualSubmissionForActor(actor, data, { storage });
  });

export const getAnnualReturnReturnIntakes = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: entityIdSchema }).strict())
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    return getReturnIntakesForActor(actor, data.caseId, { storage });
  });

export const recordAnnualReturnReturnIntake = createServerFn({ method: "POST" })
  .validator(returnIntakeSchema)
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    return ingestReturnForActor(actor, data, { storage });
  });

export const reconcileAnnualReturnReturn = createServerFn({ method: "POST" })
  .validator(returnDecisionSchema)
  .handler(async ({ data }) => {
    const { actor, storage } = await loadPackageContext();
    return reconcileReturnForActor(actor, data, { storage });
  });
