# Annual Return Pre-Pilot Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete one production-backed annual-return journey from assignment through client evidence, filing, notifications, and audit while keeping live external provisioning blocked.

**Architecture:** Close the existing vertical slice incrementally. Production routes use narrowly scoped TanStack Start server functions and React Query; repositories remain the persistence boundary, with one focused evidence orchestration service for cross-repository transactions. Demo data and deterministic local provider adapters are explicit runtime compositions and can never become production fallbacks.

**Tech Stack:** TypeScript, React 19, TanStack Start/Router/React Query, Zod, PostgreSQL/Neon, Neon Auth, Cloudflare R2-compatible storage, Vitest, ESLint, Prettier, Playwright-compatible browser verification.

## Global Constraints

- Production routes must never import mutation functions from `src/lib/annual-return-store.ts` or `src/lib/client-portal-store.ts`.
- Demo data is enabled only by an explicit non-production flag and a separate provider composition.
- Production UUID-backed requests never fall back to demo state after an error.
- Local providers must exercise production interfaces, persistence, authorization, quarantine, idempotency, retry, and delivery state without network calls.
- No live Neon, Cloudflare, R2, Hyperdrive, WhatsApp, email, malware-scanning, backup, domain, paid service, or secret change is permitted in this plan.
- Every production mutation authenticates the actor, verifies firm/company scope and role, validates current workflow state, and writes audit records.
- TypeScript and lint must exit with zero errors before the phase is complete.
- Do not stage or commit `.sdd-artifacts/`.

---

### Task 1: Finalize The Offline Deployment-Gate Checkpoint

**Files:**

- Modify: `scripts/check-production-route-imports.ts`
- Create: `scripts/check-production-route-imports.test.ts`
- Modify: `scripts/verify-firm-deployment.ts`
- Create: `scripts/verify-firm-deployment.test.ts`
- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/runbooks/firm-deployment.md`
- Create: `docs/runbooks/backup-restore.md`
- Create: `docs/runbooks/document-quarantine.md`

**Interfaces:**

- Produces: `scanProductionRoutes(input: ProductionRouteScanInput): Promise<ProductionRouteScanResult>`.
- Produces: `verifyFirmDeployment(input: FirmDeploymentVerificationInput): Promise<FirmDeploymentVerificationResult>`.
- Produces: `npm.cmd run check:production-imports` and `npm.cmd run verify:firm -- --dry-run`.

- [ ] **Step 1: Write failing unit tests for route scanning and secret-safe deployment verification**

```ts
// scripts/check-production-route-imports.test.ts
import { describe, expect, it } from "vitest";
import { scanProductionRoutes } from "./check-production-route-imports";

describe("scanProductionRoutes", () => {
  it("reports a forbidden browser mutation with its route", async () => {
    const result = await scanProductionRoutes({
      routeFiles: ["payments.tsx"],
      readRoute: async () => "acceptPaymentProof(caseId)",
    });
    expect(result.failures).toEqual([{ file: "payments.tsx", pattern: "acceptPaymentProof(" }]);
  });
});

// scripts/verify-firm-deployment.test.ts
import { describe, expect, it } from "vitest";
import { verifyFirmDeployment } from "./verify-firm-deployment";

describe("verifyFirmDeployment", () => {
  it("reports binding names but never values", async () => {
    const result = await verifyFirmDeployment({
      dryRun: true,
      fileExists: async () => true,
      readSchema: async () =>
        ["notification_outbox", "document_upload_intents", "work_items", "escalation_events"]
          .map((table) => `create table if not exists ${table}`)
          .join("\n"),
    });
    expect(result.blockedBindings).toContain("WOZTELL_ACCESS_TOKEN");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(result.networkCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and verify the CLI-only scripts fail the import contract**

Run: `npm.cmd test -- --configLoader runner scripts/check-production-route-imports.test.ts scripts/verify-firm-deployment.test.ts`

Expected: FAIL because `scanProductionRoutes` and `verifyFirmDeployment` are not exported.

- [ ] **Step 3: Extract pure verification functions and retain thin CLI entry points**

```ts
export type ProductionRouteScanInput = {
  routeFiles: readonly string[];
  readRoute(file: string): Promise<string>;
};

export type ProductionRouteScanResult = {
  scanned: number;
  failures: Array<{ file: string; pattern: string }>;
};

export async function scanProductionRoutes(
  input: ProductionRouteScanInput,
): Promise<ProductionRouteScanResult> {
  const failures: ProductionRouteScanResult["failures"] = [];
  for (const file of input.routeFiles) {
    const source = await input.readRoute(file);
    for (const pattern of FORBIDDEN_BROWSER_MUTATIONS) {
      if (source.includes(pattern)) failures.push({ file, pattern });
    }
  }
  return { scanned: input.routeFiles.length, failures };
}
```

```ts
export type FirmDeploymentVerificationResult = {
  checks: Array<{ name: string; status: "pass" | "fail" | "blocked" }>;
  blockedBindings: string[];
  blockedProviders: string[];
  networkCalls: 0;
};
```

Keep the CLI output limited to check names, statuses, file paths, binding names, and provider names. Do not read or print binding values in dry-run mode.

- [ ] **Step 4: Harden repository commands and document the offline workflow**

Set the scripts to:

```json
{
  "lint": "eslint . --ignore-pattern .worktrees/**",
  "test": "vitest run --exclude .worktrees/**",
  "test:watch": "vitest --exclude .worktrees/**",
  "check:production-imports": "node --experimental-strip-types scripts/check-production-route-imports.ts",
  "verify:firm": "node --experimental-strip-types scripts/verify-firm-deployment.ts"
}
```

Add a `Production validation` section to `README.md` with the two offline commands. Keep every external write command in the runbooks under a `REQUIRES EXPLICIT APPROVAL` heading.

- [ ] **Step 5: Run focused validation**

Run: `npm.cmd test -- --configLoader runner scripts/check-production-route-imports.test.ts scripts/verify-firm-deployment.test.ts`

Expected: PASS.

Run: `npm.cmd run check:production-imports`

Expected: `PASS production route import check (6 routes scanned)`.

Run: `npm.cmd run verify:firm -- --dry-run`

Expected: local structure and migration checks pass; live bindings/providers are blocked; zero network calls are reported.

- [ ] **Step 6: Commit the deployment-gate checkpoint**

```powershell
git add package.json README.md scripts/check-production-route-imports.ts scripts/check-production-route-imports.test.ts scripts/verify-firm-deployment.ts scripts/verify-firm-deployment.test.ts docs/runbooks
git commit -m "docs: add production deployment gates"
```

### Task 2: Enforce Strict Demo And Production Data Modes

**Files:**

- Create: `src/features/runtime/data-mode.ts`
- Create: `src/features/runtime/data-mode.test.ts`
- Create: `src/features/annual-return/query-keys.ts`
- Modify: `src/features/auth/route-guard.ts`
- Modify: `src/features/auth/route-guard.test.ts`
- Modify: `src/routes/__root.tsx`
- Modify: `src/routes/-production-authorization.test.ts`

**Interfaces:**

- Produces: `type DataMode = "demo" | "production"`.
- Produces: `resolveDataMode(input: { demoEnabled: boolean; isProductionBuild: boolean }): DataMode`.
- Produces: `annualReturnQueryKeys` for list, detail, notes, documents, payment, and notifications.

- [ ] **Step 1: Write failing data-mode and route-boundary tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveDataMode } from "./data-mode";

describe("resolveDataMode", () => {
  it("never enables demo data in a production build", () => {
    expect(resolveDataMode({ demoEnabled: true, isProductionBuild: true })).toBe("production");
  });

  it("requires an explicit flag outside production", () => {
    expect(resolveDataMode({ demoEnabled: false, isProductionBuild: false })).toBe("production");
    expect(resolveDataMode({ demoEnabled: true, isProductionBuild: false })).toBe("demo");
  });
});
```

Extend `-production-authorization.test.ts` to assert that production routes import `resolveDataMode` or a production component and never infer demo mode from an identifier shape.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm.cmd test -- --configLoader runner src/features/runtime/data-mode.test.ts src/features/auth/route-guard.test.ts src/routes/-production-authorization.test.ts`

Expected: FAIL because the runtime data-mode module and strict production-build rule do not exist.

- [ ] **Step 3: Add the pure mode resolver and stable query keys**

```ts
export type DataMode = "demo" | "production";

export function resolveDataMode(input: {
  demoEnabled: boolean;
  isProductionBuild: boolean;
}): DataMode {
  return !input.isProductionBuild && input.demoEnabled ? "demo" : "production";
}

export function currentDataMode(): DataMode {
  return resolveDataMode({
    demoEnabled: import.meta.env.VITE_ENABLE_DEMO_AUTH === "true",
    isProductionBuild: import.meta.env.PROD,
  });
}
```

```ts
export const annualReturnQueryKeys = {
  all: ["annual-returns"] as const,
  list: (filters: object) => ["annual-returns", "list", filters] as const,
  detail: (caseId: string) => ["annual-returns", "detail", caseId] as const,
  notes: (caseId: string) => ["annual-returns", "notes", caseId] as const,
  documents: (caseId: string) => ["annual-returns", "documents", caseId] as const,
  payment: (caseId: string) => ["annual-returns", "payment", caseId] as const,
  notifications: (caseId: string) => ["annual-returns", "notifications", caseId] as const,
};
```

- [ ] **Step 4: Make root routing consume the resolved mode once**

Expose the resolved `dataMode` through router context. Keep Neon Auth mandatory in production mode; demo auth may bypass it only when `dataMode === "demo"`.

```ts
const dataMode = currentDataMode();
if (!isPublicRoute(location.pathname) && dataMode === "production") {
  await getAuthenticatedActor();
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd test -- --configLoader runner src/features/runtime/data-mode.test.ts src/features/auth/route-guard.test.ts src/routes/-production-authorization.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the runtime boundary**

```powershell
git add src/features/runtime src/features/annual-return/query-keys.ts src/features/auth/route-guard.ts src/features/auth/route-guard.test.ts src/routes/__root.tsx src/routes/-production-authorization.test.ts
git commit -m "refactor: separate demo and production data modes"
```

### Task 3: Add Missing Production Case Commands

**Files:**

- Modify: `src/features/annual-return/types.ts`
- Modify: `src/features/annual-return/repository.ts`
- Modify: `src/features/annual-return/repository.test.ts`
- Modify: `src/features/annual-return/server-fns.ts`
- Create: `src/features/annual-return/server-fns.test.ts`
- Modify: `src/server/db/production-schema.test.ts`

**Interfaces:**

- Produces: `AnnualReturnCaseNote`.
- Produces: `AnnualReturnRepository.assignOwner`, `listNotes`, and `addNote`.
- Produces: `assignAnnualReturnCaseOwnerForActor`, `addAnnualReturnCaseNoteForActor`, `assignAnnualReturnCaseOwner`, `listAnnualReturnCaseNotes`, and `addAnnualReturnCaseNote`.
- `assignOwner` synchronizes the case owner and all non-completed work items for the case in one transaction.

- [ ] **Step 1: Write failing repository tests for synchronized ownership and notes**

```ts
it("updates the case and active work items in one owner assignment", async () => {
  const updated = await repository.assignOwner({
    caseId,
    ownerId: newOwnerId,
    actorId: managerId,
  });
  expect(updated.ownerId).toBe(newOwnerId);
  expect(sql.events).toContainEqual(
    expect.objectContaining({ eventType: "annual_return_owner_assigned" }),
  );
});

it("persists and lists case notes in chronological order", async () => {
  await repository.addNote({ caseId, body: "Client confirmed the address.", actorId: staffId });
  expect(await repository.listNotes(caseId)).toEqual([
    expect.objectContaining({ body: "Client confirmed the address.", authorId: staffId }),
  ]);
});
```

- [ ] **Step 2: Run repository tests and verify missing methods fail**

Run: `npm.cmd test -- --configLoader runner src/features/annual-return/repository.test.ts`

Expected: FAIL because `assignOwner`, `addNote`, and `listNotes` are absent.

- [ ] **Step 3: Add exact repository contracts and transactional implementations**

```ts
export type AnnualReturnCaseNote = {
  id: string;
  caseId: string;
  authorId: string;
  body: string;
  createdAt: string;
};

export type AssignAnnualReturnOwnerInput = {
  caseId: string;
  ownerId: string;
  actorId: string;
};

export type AddAnnualReturnCaseNoteInput = {
  caseId: string;
  body: string;
  actorId: string;
};
```

Inside `assignOwner`, lock the annual-return case, authorize the actor with the existing mutation guard, update `annual_return_cases.owner_id`, update active `work_items.owner_id` where `case_id` matches, and append one timeline event. Inside `addNote`, insert `case_notes` and a `case_note_added` timeline event in the same transaction.

- [ ] **Step 4: Write failing server-function authorization tests**

```ts
it("rejects client owner assignment", async () => {
  await expect(
    assignAnnualReturnCaseOwnerForActor(clientActor, { caseId, ownerId }, dependencies),
  ).rejects.toThrow("Staff access required");
});

it("trims and persists a staff note", async () => {
  const note = await addAnnualReturnCaseNoteForActor(
    staffActor,
    { caseId, body: "  Ready for review.  " },
    dependencies,
  );
  expect(note.body).toBe("Ready for review.");
});
```

- [ ] **Step 5: Add Zod-validated server functions**

```ts
const assignOwnerSchema = z
  .object({ caseId: z.string().uuid(), ownerId: z.string().uuid() })
  .strict();
const addNoteSchema = z
  .object({ caseId: z.string().uuid(), body: z.string().trim().min(1).max(2000) })
  .strict();

export const assignAnnualReturnCaseOwner = createServerFn({ method: "POST" })
  .inputValidator(assignOwnerSchema)
  .handler(({ data }) =>
    withAnnualReturnRepository((repository, actorId) =>
      repository.assignOwner({ ...data, actorId }),
    ),
  );
```

Implement `listAnnualReturnCaseNotes` and `addAnnualReturnCaseNote` through the same authenticated repository wrapper.

- [ ] **Step 6: Run focused tests**

Run: `npm.cmd test -- --configLoader runner src/features/annual-return/repository.test.ts src/features/annual-return/server-fns.test.ts src/server/db/production-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit production case commands**

```powershell
git add src/features/annual-return src/server/db/production-schema.test.ts
git commit -m "feat: add production annual return case commands"
```

### Task 4: Convert The Annual-Return Detail Route

**Files:**

- Create: `src/features/annual-return/components/production-case-detail.tsx`
- Create: `src/features/annual-return/components/demo-case-detail.tsx`
- Modify: `src/routes/annual-returns.$id.tsx`
- Modify: `src/routes/-annual-returns-workflow.test.ts`
- Modify: `src/routes/-production-authorization.test.ts`

**Interfaces:**

- Consumes: Task 2 `currentDataMode` and `annualReturnQueryKeys`.
- Consumes: Task 3 case-owner and note server functions plus existing annual-return server functions.
- Produces: a production detail screen with no warning-only controls.

- [ ] **Step 1: Add failing route-contract tests for every production action**

```ts
it("wires the production detail route to server-backed commands", async () => {
  const source = await readRoute("annual-returns.$id.tsx");
  expect(source).toContain("ProductionAnnualReturnCaseDetail");
  expect(source).not.toContain("Production owner actions are handled");
  expect(source).not.toContain("Production checklist state is managed");
  expect(source).not.toContain("useAnnualReturnCase(");
});
```

Add component tests that click owner, status, checklist, payment, note, reminder, packet, and receipt controls and assert the matching mocked server function receives a UUID-backed payload.

- [ ] **Step 2: Run route tests and verify warning-only behavior fails**

Run: `npm.cmd test -- --configLoader runner src/routes/-annual-returns-workflow.test.ts src/routes/-production-authorization.test.ts`

Expected: FAIL because the detail route still renders browser-store data and warning-only handlers.

- [ ] **Step 3: Split the current demo UI from the production component**

Move the existing browser-store component into `demo-case-detail.tsx` without changing its fixture behavior. Make the route select the component only through `currentDataMode()`:

```tsx
function AnnualReturnDetailRoute() {
  const { id } = Route.useParams();
  return currentDataMode() === "demo" ? (
    <DemoAnnualReturnCaseDetail caseId={id} />
  ) : (
    <ProductionAnnualReturnCaseDetail caseId={id} />
  );
}
```

- [ ] **Step 4: Build the production query and mutation shell**

```tsx
const caseQuery = useQuery({
  queryKey: annualReturnQueryKeys.detail(caseId),
  queryFn: () => getAnnualReturnCase({ data: { caseId } }),
});

const statusMutation = useMutation({
  mutationFn: (nextStatus: AnnualReturnStatus) =>
    updateAnnualReturnStatus({ data: { caseId, nextStatus } }),
  onSuccess: (caseItem) => {
    queryClient.setQueryData(annualReturnQueryKeys.detail(caseId), caseItem);
    return queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
  },
});
```

Use the same pattern for owner assignment, checklist review, payment state, filing proof, notes, and WhatsApp reminders. Disable only the mutation's affected controls while pending; retain entered note/reference values after failure.

- [ ] **Step 5: Map packet and receipt actions to existing production states**

Use verified required checklist items plus `Payment received` as packet readiness. `Submit packet` transitions the case to `NAR1 prepared`, and `Ready to file` remains a separate status transition. `Accept receipt` requires a verified `receipt` document and calls `updateAnnualReturnFilingProof` with the filing reference and confirmation document ID.

- [ ] **Step 6: Run route and server tests**

Run: `npm.cmd test -- --configLoader runner src/routes/-annual-returns-workflow.test.ts src/routes/-production-authorization.test.ts src/features/annual-return/server-fns.test.ts`

Expected: PASS; no production detail action imports or calls a browser mutation.

- [ ] **Step 7: Commit the production detail route**

```powershell
git add src/features/annual-return/components src/routes/annual-returns.$id.tsx src/routes/-annual-returns-workflow.test.ts src/routes/-production-authorization.test.ts
git commit -m "feat: complete production annual return case actions"
```

### Task 5: Orchestrate Client Evidence And Staff Review

**Files:**

- Create: `src/features/annual-return/evidence-service.ts`
- Create: `src/features/annual-return/evidence-service.test.ts`
- Create: `src/features/annual-return/evidence-server-fns.ts`
- Create: `src/features/annual-return/evidence-server-fns.test.ts`
- Modify: `src/features/documents/repository.ts`
- Modify: `src/routes/documents.tsx`
- Modify: `src/routes/payments.tsx`
- Modify: `src/routes/portal.tsx`
- Modify: `src/routes/-annual-returns-workflow.test.ts`
- Modify: `src/routes/-production-authorization.test.ts`

**Interfaces:**

- Produces: `createAnnualReturnEvidenceService(dependencies): AnnualReturnEvidenceService` and `reviewEvidence(input): Promise<{ document: PrivateDocument; caseItem: AnnualReturnCase }>`.
- Produces: `reviewAnnualReturnEvidenceAction` server function.
- Produces: `acceptAnnualReturnFilingReceiptAction` server function.
- Consumes: the existing private upload, scan, list, download, and review repositories.

- [ ] **Step 1: Write failing transaction tests for checklist and payment evidence**

```ts
it("verifies payment proof and updates payment in one transaction", async () => {
  const result = await service.reviewEvidence({
    caseId,
    documentId: paymentDocumentId,
    decision: "verified",
    actorId: reviewerId,
  });
  expect(result.document.reviewStatus).toBe("verified");
  expect(result.caseItem.payment).toEqual(
    expect.objectContaining({
      status: "Payment received",
      paymentProofDocumentId: paymentDocumentId,
    }),
  );
});

it("rejects evidence belonging to another case", async () => {
  await expect(
    service.reviewEvidence({
      caseId,
      documentId: otherCaseDocumentId,
      decision: "verified",
      actorId,
    }),
  ).rejects.toThrow("Document does not belong to this annual return case.");
});
```

- [ ] **Step 2: Run evidence tests and verify the orchestration service is missing**

Run: `npm.cmd test -- --configLoader runner src/features/annual-return/evidence-service.test.ts`

Expected: FAIL because `createAnnualReturnEvidenceService` is not defined.

- [ ] **Step 3: Implement a focused shared-transaction service**

```ts
export type ReviewAnnualReturnEvidenceInput = {
  caseId: string;
  documentId: string;
  checklistItemId?: string;
  decision: "verified" | "rejected";
  reason?: string;
  actorId: string;
};

export type AnnualReturnEvidenceService = {
  reviewEvidence(input: ReviewAnnualReturnEvidenceInput): Promise<{
    document: PrivateDocument;
    caseItem: AnnualReturnCase;
  }>;
  acceptFilingReceipt(input: {
    caseId: string;
    documentId: string;
    filingReference: string;
    actorId: string;
  }): Promise<AnnualReturnCase>;
};
```

Construct the document and annual-return repositories with the same transaction client. Require `uploadStatus === "available"`, matching `caseId`, and the expected category. Verified payment evidence updates payment to `Payment received`; rejected payment evidence keeps `Payment pending` and clears the proof ID. Checklist evidence requires `checklistItemId` and maps the decision to `Verified` or `Rejected`. Filing receipt acceptance requires a verified `receipt` document.

- [ ] **Step 4: Write and implement server-function authorization tests**

```ts
const reviewEvidenceSchema = z
  .object({
    caseId: z.string().uuid(),
    documentId: z.string().uuid(),
    checklistItemId: z.string().uuid().optional(),
    decision: z.enum(["verified", "rejected"]),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
```

Require staff access for review and receipt acceptance. Client actors may create/finalize uploads and list/download permitted documents through the existing document server functions, but they cannot call evidence-review actions.

- [ ] **Step 5: Replace document, payment, and portal warning handlers**

`documents.tsx` calls `reviewAnnualReturnEvidenceAction` for UUID-backed case evidence. `payments.tsx` lists payment-category documents and uses the same review action. `portal.tsx` uses the existing upload-intent/finalize flow, refreshes document queries after completion, and never receives a public object URL.

```tsx
const reviewMutation = useMutation({
  mutationFn: reviewAnnualReturnEvidenceAction,
  onSuccess: ({ caseItem }) => {
    queryClient.setQueryData(annualReturnQueryKeys.detail(caseItem.id), caseItem);
    return queryClient.invalidateQueries({
      queryKey: annualReturnQueryKeys.documents(caseItem.id),
    });
  },
});
```

- [ ] **Step 6: Run evidence and route tests**

Run: `npm.cmd test -- --configLoader runner src/features/annual-return/evidence-service.test.ts src/features/annual-return/evidence-server-fns.test.ts src/features/documents src/routes/-annual-returns-workflow.test.ts src/routes/-production-authorization.test.ts`

Expected: PASS; cross-company, cross-case, quarantine, rejected replacement, and duplicate review cases are covered.

- [ ] **Step 7: Commit evidence orchestration**

```powershell
git add src/features/annual-return/evidence-service.ts src/features/annual-return/evidence-service.test.ts src/features/annual-return/evidence-server-fns.ts src/features/annual-return/evidence-server-fns.test.ts src/features/documents/repository.ts src/routes/documents.tsx src/routes/payments.tsx src/routes/portal.tsx src/routes/-annual-returns-workflow.test.ts src/routes/-production-authorization.test.ts
git commit -m "feat: complete production evidence review workflow"
```

### Task 6: Add Deterministic Local Providers And Durable Send Now

**Files:**

- Create: `src/server/provider-mode.ts`
- Create: `src/server/provider-mode.test.ts`
- Create: `src/features/documents/local-r2.ts`
- Create: `src/features/documents/local-r2.test.ts`
- Create: `src/features/notifications/local-transport.ts`
- Create: `src/features/notifications/local-transport.test.ts`
- Modify: `src/features/documents/server-fns.ts`
- Modify: `src/features/notifications/dispatcher.ts`
- Modify: `src/features/notifications/dispatcher.test.ts`
- Modify: `src/routes/whatsapp.automation.tsx`
- Modify: `src/routes/-annual-returns-workflow.test.ts`

**Interfaces:**

- Produces: `type ProviderMode = "local" | "live"` and `resolveProviderMode`.
- Produces: `createMemoryR2Bucket(): R2BucketLike`.
- Produces: `createLocalNotificationTransport(): NotificationTransport`.
- Consumes: existing notification outbox and annual-return reminder server function.

- [ ] **Step 1: Write failing provider-mode and adapter tests**

```ts
it("blocks local providers in a production build", () => {
  expect(() => resolveProviderMode({ requested: "local", isProductionBuild: true })).toThrow(
    "Local providers are unavailable in production builds.",
  );
});

it("round-trips private object metadata in memory", async () => {
  const storage = createDocumentStorage(createMemoryR2Bucket());
  await storage.put({
    objectKey: "documents/test",
    body: new Uint8Array([1, 2, 3]),
    checksum: "a".repeat(64),
    contentType: "application/pdf",
    sizeBytes: 3,
  });
  expect(await storage.head("documents/test")).toEqual(
    expect.objectContaining({ sizeBytes: 3, checksum: "a".repeat(64) }),
  );
});
```

- [ ] **Step 2: Run adapter tests and verify the modules are absent**

Run: `npm.cmd test -- --configLoader runner src/server/provider-mode.test.ts src/features/documents/local-r2.test.ts src/features/notifications/local-transport.test.ts`

Expected: FAIL because local provider modules do not exist.

- [ ] **Step 3: Implement explicit provider selection and singleton local adapters**

```ts
export type ProviderMode = "local" | "live";

export function resolveProviderMode(input: {
  requested: ProviderMode;
  isProductionBuild: boolean;
}): ProviderMode {
  if (input.isProductionBuild && input.requested === "local") {
    throw new Error("Local providers are unavailable in production builds.");
  }
  return input.requested;
}
```

The memory R2 bucket stores cloned bytes and metadata in a module-level `Map<string, MemoryR2Object>`. The local notification transport returns `local:${outboxId}` as the provider message ID and records payloads for tests; it does not call `fetch`.

- [ ] **Step 4: Compose local providers through server-only contexts**

In document server functions, choose the singleton memory R2 bucket only when `ProviderMode === "local"`; otherwise use `getFirmRuntimeEnv().documentsBucket`. Continue using the deterministic scanner locally. In notification dispatch, select the local transport only through the same explicit provider mode.

- [ ] **Step 5: Wire automation Send now to the durable annual-return reminder action**

```tsx
const sendMutation = useMutation({
  mutationFn: (draft: AnnualReturnFollowUpDraft) =>
    queueAnnualReturnWhatsAppReminderMessage({
      data: {
        caseId: draft.caseId,
        recipientName: draft.recipientName,
        recipientPhone: draft.phone,
      },
    }),
  onSuccess: (_caseItem, draft) =>
    queryClient.invalidateQueries({
      queryKey: annualReturnQueryKeys.notifications(draft.caseId),
    }),
});
```

Document-review and payment-proof drafts call their matching evidence follow-up server actions. A row with demo identifiers renders only in demo mode.

- [ ] **Step 6: Run provider, dispatcher, and route tests**

Run: `npm.cmd test -- --configLoader runner src/server/provider-mode.test.ts src/features/documents/local-r2.test.ts src/features/documents/server-fns.test.ts src/features/notifications/local-transport.test.ts src/features/notifications/dispatcher.test.ts src/routes/-annual-returns-workflow.test.ts`

Expected: PASS; tests assert zero network calls in local mode and persisted outbox/provider IDs.

- [ ] **Step 7: Commit local providers and durable send now**

```powershell
git add src/server/provider-mode.ts src/server/provider-mode.test.ts src/features/documents/local-r2.ts src/features/documents/local-r2.test.ts src/features/documents/server-fns.ts src/features/notifications/local-transport.ts src/features/notifications/local-transport.test.ts src/features/notifications/dispatcher.ts src/features/notifications/dispatcher.test.ts src/routes/whatsapp.automation.tsx src/routes/-annual-returns-workflow.test.ts
git commit -m "feat: add local production adapters and durable send now"
```

### Task 7: Remove Compiler And Lint Debt

**Files:**

- Modify: `src/lib/client-portal-store.ts`
- Modify: `src/routes/index.tsx`
- Modify: `src/routes/whatsapp.automation.tsx`
- Modify: `vite.config.ts`
- Format: files reported by `npm.cmd run lint`
- Test: `src/lib/client-portal-store.test.ts`
- Test: `vite.config.test.ts`

**Interfaces:**

- Produces: zero TypeScript errors and zero ESLint errors.
- Preserves: the six existing Fast Refresh warnings unless component exports are already touched by another task.

- [ ] **Step 1: Capture the current compiler and lint failures**

Run: `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`

Expected: FAIL at the known client-portal narrowing, WhatsApp union, link-search, and Vite plugin-flattening sites before fixes.

Run: `npm.cmd run lint`

Expected: FAIL only with repository formatting errors after `.worktrees/**` is excluded.

- [ ] **Step 2: Add regression assertions for the narrowing and plugin cases**

```ts
it("marks archive rows read-only when their annual-return case is absent", () => {
  const rows = getDocumentArchiveRows([]);
  expect(rows.every((row) => !row.reviewable)).toBe(true);
});
```

Extend `vite.config.test.ts` with a promised plugin option and assert the resulting plugin array is flat and ordered.

- [ ] **Step 3: Apply exact type-safe fixes**

Use a type predicate when filtering optional cases:

```ts
.filter((caseItem): caseItem is AnnualReturnCase => caseItem !== undefined)
```

Annotate follow-up map results with their declared draft types so `status` remains a literal union. Add `search={{}}` to the `/whatsapp` link. Narrow the draft union before reading `reasonLabel`:

```ts
const reasonLabel = "reasonLabel" in draft ? draft.reasonLabel : "Annual return follow-up";
```

Make Vite plugin flattening await promised plugin options:

```ts
async function flattenPlugins(plugins: PluginOption[]): Promise<Plugin[]> {
  const groups = await Promise.all(
    plugins.map(async (candidate) => {
      const plugin = await candidate;
      if (!plugin) return [];
      return Array.isArray(plugin) ? flattenPlugins(plugin) : [plugin];
    }),
  );
  return groups.flat();
}
```

- [ ] **Step 4: Format only files reported by lint**

Run:

```powershell
npm.cmd exec prettier -- --write src/features/annual-return/session.ts src/features/auth/auth-context-neon.tsx src/features/auth/neon-auth-server.ts src/features/auth/session.ts src/features/whatsapp/types.ts src/features/work-items/assignment.test.ts src/features/work-items/assignment.ts src/features/work-items/business-calendar.test.ts src/lib/ai-agent.ts src/lib/annual-return-store.ts src/lib/app-data.ts src/lib/client-portal-store.ts src/lib/knowledge-base.ts src/routes/login.tsx
```

Expected: formatting changes are mechanical; do not format `.worktrees/**` or unrelated generated artifacts.

- [ ] **Step 5: Run compiler, lint, and focused tests**

Run: `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`

Expected: exit 0 with no diagnostics.

Run: `npm.cmd run lint`

Expected: zero errors; only the six existing `react-refresh/only-export-components` warnings are acceptable.

Run: `npm.cmd test -- --configLoader runner src/lib/client-portal-store.test.ts vite.config.test.ts src/routes/-annual-returns-workflow.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit verification-debt fixes**

```powershell
git add src vite.config.ts
git commit -m "fix: clear production verification debt"
```

### Task 8: Full Pre-Pilot Verification And Launch-Blocker Evidence

**Files:**

- Modify: `README.md`
- Modify: `docs/runbooks/firm-deployment.md`
- Modify: `docs/runbooks/backup-restore.md`
- Modify: `docs/runbooks/document-quarantine.md`
- Modify: `scripts/verify-firm-deployment.ts`
- Modify: `scripts/verify-firm-deployment.test.ts`
- Test: all changed tests

**Interfaces:**

- Consumes: the complete production-backed annual-return journey.
- Produces: reproducible automated gates, browser evidence, and an exact list of blocked live integrations.

- [ ] **Step 1: Extend the deployment verifier with completion gates**

Add named checks for strict data mode, route import guard, local provider mode, migration schema, Neon Auth capability, database, storage, scanner, WhatsApp, email, cron, backups, and browser evidence. Each check returns `pass`, `fail`, or `blocked`; secret values are never accepted as result fields.

```ts
expect(result.checks).toEqual(
  expect.arrayContaining([
    { name: "strict-data-mode", status: "pass" },
    { name: "malware-scanner", status: "blocked" },
    { name: "backups", status: "blocked" },
  ]),
);
```

- [ ] **Step 2: Run focused production gates**

Run: `npm.cmd run check:production-imports`

Expected: PASS with every production route free of browser mutations.

Run: `npm.cmd run verify:firm -- --dry-run`

Expected: local implementation gates pass; live resources remain blocked; no network call or resource write occurs.

- [ ] **Step 3: Run the complete automated suite**

Run: `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`

Expected: exit 0.

Run: `npm.cmd test -- --configLoader runner`

Expected: all repository tests pass; database-dependent tests skip only when `TEST_DATABASE_URL` is absent.

Run: `npm.cmd run lint`

Expected: zero errors.

Run: `npm.cmd run build -- --configLoader runner`

Expected: exit 0; existing Vite/Nitro advisory warnings are acceptable.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 4: Start the local production-data journey**

Run: `npm.cmd run dev -- --host 127.0.0.1`

Expected: the terminal prints an available localhost URL. Use explicit local provider mode and production data mode; do not enable demo auth/data.

- [ ] **Step 5: Verify desktop and mobile browser journeys**

At `1440x1000` and `390x844`, verify:

1. Staff login and protected-route redirect.
2. Work-queue recommendation, manager confirmation, and owner synchronization.
3. SLA warning/breach state and acknowledgement.
4. Annual-return detail status, checklist, note, payment, packet, and filing actions.
5. Client portal access isolation, upload, quarantine, scan, replacement, and review outcome.
6. Payment-proof review and case/payment synchronization.
7. Durable Send now, outbox dispatch, local provider ID, and delivery state.
8. Integration-health binding names with no secret values.

Expected: no console errors, no failed application requests, no horizontal overflow, and no control that only displays a warning instead of performing its production action.

- [ ] **Step 6: Run final branch review**

Review the complete range from `3976932` to HEAD. Resolve Critical and Important findings, rerun Steps 2-5, and keep every live provisioning gate blocked.

- [ ] **Step 7: Commit final verification evidence**

```powershell
git add README.md docs/runbooks scripts/verify-firm-deployment.ts scripts/verify-firm-deployment.test.ts
git commit -m "docs: record annual return pre-pilot readiness"
```

## Execution Notes

- Use the existing isolated worktree at `C:\tmp\kossilon-hub-pr`; do not implement on `main`.
- Before Task 1, confirm the authoritative branch is `codex-production-assignment-sla-implementation` and preserve all existing unstaged Task 10 files.
- Use a fresh worker and two-stage review for each task when subagents are available.
- Do not move to live first-firm provisioning when this plan completes. Present the exact blocked resources and request separate approval.
