import {
  getAnnualReturnDashboardMetrics,
  listAnnualReturnCases,
} from "@/features/annual-return/server-fns";
import type { AnnualReturnDashboardMetrics } from "@/features/annual-return/repository";
import type { DashboardCase } from "@/features/dashboard/types";
import type { AuthenticatedActor } from "@/features/auth/types";

export type DashboardDataDependencies = {
  getAnnualReturnDashboardMetrics: () => Promise<AnnualReturnDashboardMetrics>;
  listAnnualReturnCases: (input: {
    data: { activeOnly?: boolean; limit?: number };
  }) => Promise<DashboardCase[]>;
};

export type DashboardDataErrorKind = "forbidden" | "unavailable";

export type DashboardData = {
  actorScopeKey?: string;
  metrics: AnnualReturnDashboardMetrics;
  upcomingAnnualReturns: DashboardCase[];
  annualReturnDataAvailable: boolean;
  annualReturnDataError: string | null;
  annualReturnDataErrorKind: DashboardDataErrorKind | null;
};

const fallbackAnnualReturnMetrics: AnnualReturnDashboardMetrics = {
  businessDate: "",
  total: 0,
  activeCases: 0,
  overdueCases: 0,
  missingDocumentCount: 0,
  casesWithMissingDocuments: 0,
  dueIn7: 0,
  dueIn30: 0,
  overdue: 0,
  highRisk: 0,
  missingDocuments: 0,
  paymentPending: 0,
  assignedToMe: 0,
};

// The repository throws `Forbidden: ` / `Unauthorized: ` prefixed errors by
// convention for authz failures. Those mean sign in again; anything else means
// try again later. Collapsing them into one message, as this used to, told the
// reader nothing about which.
function describeAnnualReturnError(error: unknown): {
  kind: DashboardDataErrorKind;
  message: string;
} {
  const cause = error instanceof Error ? error.message : String(error);

  if (/^(Forbidden|Unauthorized):/.test(cause)) {
    return {
      kind: "forbidden",
      message: `You do not have access to annual return data. ${cause}`,
    };
  }

  return { kind: "unavailable", message: `Annual return data could not be loaded. ${cause}` };
}

const defaultDependencies: DashboardDataDependencies = {
  getAnnualReturnDashboardMetrics,
  listAnnualReturnCases,
};

export async function loadDashboardData(
  dependencies: DashboardDataDependencies = defaultDependencies,
): Promise<DashboardData> {
  try {
    const [metrics, annualReturnCases] = await Promise.all([
      dependencies.getAnnualReturnDashboardMetrics(),
      dependencies.listAnnualReturnCases({ data: { activeOnly: true, limit: 8 } }),
    ]);

    return {
      metrics,
      upcomingAnnualReturns: annualReturnCases
        .filter((case_) => case_.currentStatus !== "Completed" && case_.currentStatus !== "Filed")
        .slice(0, 8),
      annualReturnDataAvailable: true,
      annualReturnDataError: null,
      annualReturnDataErrorKind: null,
    };
  } catch (error) {
    // This is a staff-only internal screen, so surfacing the cause is a help
    // rather than a disclosure. Do not copy this onto a client-facing route.
    console.error("Dashboard annual-return load failed", error);
    const { kind, message } = describeAnnualReturnError(error);

    return {
      metrics: fallbackAnnualReturnMetrics,
      upcomingAnnualReturns: [],
      annualReturnDataAvailable: false,
      annualReturnDataError: message,
      annualReturnDataErrorKind: kind,
    };
  }
}

export function dashboardActorScopeKey(actor: AuthenticatedActor | null): string {
  return JSON.stringify(
    actor ? [actor.authUserId, actor.userId, actor.role, actor.teamId, actor.active] : null,
  );
}

/** A cached privileged loader must never render under a different identity/role. */
export function dashboardDataForActor(
  data: DashboardData,
  actor: AuthenticatedActor | null,
): DashboardData {
  if (data.actorScopeKey === dashboardActorScopeKey(actor)) return data;
  return {
    ...data,
    metrics: fallbackAnnualReturnMetrics,
    upcomingAnnualReturns: [],
    annualReturnDataAvailable: false,
    annualReturnDataError: "身份或授權範圍已變更，請重新載入統計。",
    annualReturnDataErrorKind: "forbidden",
  };
}
