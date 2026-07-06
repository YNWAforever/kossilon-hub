import {
  getAnnualReturnDashboardMetrics,
  listAnnualReturnCases,
} from "@/features/annual-return/server-fns";
import type { AnnualReturnDashboardMetrics } from "@/features/annual-return/repository";
import type { AnnualReturnCase } from "@/features/annual-return/types";

type DashboardDataDependencies = {
  getAnnualReturnDashboardMetrics: () => Promise<AnnualReturnDashboardMetrics>;
  listAnnualReturnCases: (input: { data: Record<string, never> }) => Promise<AnnualReturnCase[]>;
};

export type DashboardData = {
  metrics: AnnualReturnDashboardMetrics;
  upcomingAnnualReturns: AnnualReturnCase[];
  annualReturnDataAvailable: boolean;
  annualReturnDataError: string | null;
};

const fallbackAnnualReturnMetrics: AnnualReturnDashboardMetrics = {
  dueIn7: 0,
  dueIn30: 0,
  overdue: 0,
  highRisk: 0,
  missingDocuments: 0,
  paymentPending: 0,
  assignedToMe: 0,
};
const fallbackAnnualReturnDataError = "Annual return data is temporarily unavailable.";

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
      dependencies.listAnnualReturnCases({ data: {} }),
    ]);

    return {
      metrics,
      upcomingAnnualReturns: annualReturnCases
        .filter((case_) => case_.currentStatus !== "Completed")
        .slice(0, 8),
      annualReturnDataAvailable: true,
      annualReturnDataError: null,
    };
  } catch {
    return {
      metrics: fallbackAnnualReturnMetrics,
      upcomingAnnualReturns: [],
      annualReturnDataAvailable: false,
      annualReturnDataError: fallbackAnnualReturnDataError,
    };
  }
}
