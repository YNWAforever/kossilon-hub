import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";

import type { AnnualReturnRepository } from "./repository";
import type { AnnualReturnCase, AnnualReturnStatus, PaymentStatus } from "./types";

/**
 * The client-facing half of the annual return.
 *
 * Everything else in this feature resolves a staff actor: `getCurrentAnnualReturnActor`
 * calls `requireStaffActor`, so a Client sign-in was refused by every read. The
 * documents feature already serves Client actors — `authorizeCompany` routes them
 * through `requireClientCompanyAccess` — but a client had no way to discover a case
 * id, so the one surface built for them was unreachable.
 *
 * Scope comes from `client_company_memberships` and nothing else. A caller cannot
 * name a company; the membership list is resolved from the request and used as the
 * filter, so there is no id for a client to tamper with.
 */
export type ClientPortalCaseSummary = {
  id: string;
  companyId: string;
  companyName: string;
  returnYear: number;
  filingDueDate: string;
  currentStatus: AnnualReturnStatus;
  outstandingRequiredItems: number;
  paymentStatus: PaymentStatus | null;
};

/** What a client may see of their own filing. No staff assignment, no risk grade. */
export type ClientPortalCaseDetail = {
  id: string;
  companyId: string;
  companyName: string;
  returnYear: number;
  madeUpDate: string;
  filingDueDate: string;
  currentStatus: AnnualReturnStatus;
  filingReference: string | null;
  completedAt: string | null;
  checklist: Array<{
    id: string;
    itemLabel: string;
    required: boolean;
    status: AnnualReturnCase["checklist"][number]["status"];
    dueDate: string;
  }>;
  payment: {
    invoiceNumber: string;
    amount: number;
    currency: "HKD";
    status: PaymentStatus;
    dueDate: string;
  } | null;
};

export type ClientPortalDependencies = {
  repository: Pick<AnnualReturnRepository, "listCases">;
  listCompanyIds(): Promise<string[]>;
};

function toSummary(case_: AnnualReturnCase): ClientPortalCaseSummary {
  return {
    id: case_.id,
    companyId: case_.companyId,
    companyName: case_.companyName,
    returnYear: case_.returnYear,
    filingDueDate: case_.filingDueDate,
    currentStatus: case_.currentStatus,
    outstandingRequiredItems: case_.checklist.filter(
      (item) => item.required && item.status !== "Verified",
    ).length,
    paymentStatus: case_.payment?.status ?? null,
  };
}

export async function listClientPortalCasesForActor(
  dependencies: ClientPortalDependencies,
): Promise<ClientPortalCaseSummary[]> {
  const companyIds = await dependencies.listCompanyIds();

  // No memberships means no cases. Passing an empty array through to the filter
  // would be an unscoped read, so it short-circuits instead.
  if (companyIds.length === 0) return [];

  const cases = await dependencies.repository.listCases({ companyIds });
  return cases.map(toSummary);
}

export async function getClientPortalCaseForActor(
  input: { caseId: string },
  dependencies: ClientPortalDependencies,
): Promise<ClientPortalCaseDetail | null> {
  const companyIds = await dependencies.listCompanyIds();
  if (companyIds.length === 0) return null;

  // Filtered by membership rather than fetched by id and checked afterwards, so a
  // case outside the client's companies is not read at all.
  const cases = await dependencies.repository.listCases({ companyIds });
  const case_ = cases.find((candidate) => candidate.id === input.caseId);
  return case_ ? toClientDetail(case_) : null;
}

/**
 * Projected rather than returned whole.
 *
 * AnnualReturnCase is the internal staff record: it carries ownerId/ownerName,
 * reviewerId/reviewerName and riskLevel — who inside the firm is handling the
 * file and how badly the firm thinks it is going. An earlier version of this
 * handed that object straight to the client because the staff detail view
 * happened to take the same type. A client sees their filing, not the firm's
 * internal assignment and grading of it.
 */
function toClientDetail(case_: AnnualReturnCase): ClientPortalCaseDetail {
  return {
    id: case_.id,
    companyId: case_.companyId,
    companyName: case_.companyName,
    returnYear: case_.returnYear,
    madeUpDate: case_.madeUpDate,
    filingDueDate: case_.filingDueDate,
    currentStatus: case_.currentStatus,
    filingReference: case_.filingReference,
    completedAt: case_.completedAt,
    checklist: case_.checklist.map((item) => ({
      id: item.id,
      itemLabel: item.itemLabel,
      required: item.required,
      status: item.status,
      dueDate: item.dueDate,
    })),
    payment: case_.payment
      ? {
          invoiceNumber: case_.payment.invoiceNumber,
          amount: case_.payment.amount,
          currency: case_.payment.currency,
          status: case_.payment.status,
          dueDate: case_.payment.dueDate,
        }
      : null,
  };
}

const loadClientPortalDependencies = createServerOnlyFn(async () => {
  const [{ getRequest }, { listActiveClientCompanyIds }, { createAnnualReturnRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  const request = getRequest();
  return {
    repository: createAnnualReturnRepository(),
    listCompanyIds: () => listActiveClientCompanyIds(request),
  };
});

async function withClientPortalDependencies<T>(
  handler: (dependencies: ClientPortalDependencies) => Promise<T>,
): Promise<T> {
  const dependencies = await loadClientPortalDependencies();

  try {
    return await handler(dependencies);
  } finally {
    await dependencies.repository.close();
  }
}

export const listClientPortalCases = createServerFn({ method: "GET" })
  .validator(z.undefined().or(z.object({}).strict()))
  .handler(() => withClientPortalDependencies(listClientPortalCasesForActor));

export const getClientPortalCase = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid() }).strict())
  .handler(({ data }) =>
    withClientPortalDependencies((dependencies) => getClientPortalCaseForActor(data, dependencies)),
  );
