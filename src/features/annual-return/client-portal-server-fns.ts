import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { createAnnualReturnRepository, type AnnualReturnRepository } from "./repository";
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
): Promise<AnnualReturnCase | null> {
  const companyIds = await dependencies.listCompanyIds();
  if (companyIds.length === 0) return null;

  // Filtered by membership rather than fetched by id and checked afterwards, so a
  // case outside the client's companies is not read at all.
  const cases = await dependencies.repository.listCases({ companyIds });
  return cases.find((case_) => case_.id === input.caseId) ?? null;
}

async function withClientPortalDependencies<T>(
  handler: (dependencies: ClientPortalDependencies) => Promise<T>,
): Promise<T> {
  const [{ listActiveClientCompanyIds }] = await Promise.all([
    import("@/features/auth/neon-auth-server"),
  ]);
  const request = getRequest();
  const repository = createAnnualReturnRepository();

  try {
    return await handler({
      repository,
      listCompanyIds: () => listActiveClientCompanyIds(request),
    });
  } finally {
    await repository.close();
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
