import { createFileRoute } from "@tanstack/react-router";

import {
  type AnnualReturnPaymentStatus,
  getReadinessScore,
  useAnnualReturnCases,
} from "../lib/annual-return-store";

export const Route = createFileRoute("/payments")({
  component: PaymentsRoute,
});

const paymentLabels: Record<AnnualReturnPaymentStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  overdue: "Overdue",
};

function PaymentsRoute() {
  const cases = useAnnualReturnCases();

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Finance</p>
        <h1 className="mt-1 text-3xl font-semibold">Payments</h1>
      </div>
      <div className="rounded-lg border bg-card">
        {cases.map((caseItem) => (
          <div
            key={caseItem.id}
            className="grid gap-3 border-b p-4 text-sm last:border-b-0 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]"
          >
            <span>{caseItem.companyName}</span>
            <span>{caseItem.owner}</span>
            <span>{caseItem.dueDate}</span>
            <span className="font-medium">{paymentLabels[caseItem.paymentStatus]}</span>
            <span>{getReadinessScore(caseItem)}% ready</span>
          </div>
        ))}
      </div>
    </div>
  );
}
