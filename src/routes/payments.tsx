import { createFileRoute, Link } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { companies, formatDate } from "@/lib/mock-data";
import { KpiCard } from "@/components/kpi-card";
import { CreditCard, TrendingUp, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Kossilon CoSec OS" },
      {
        name: "description",
        content: "Track invoices, payment status, and automated reminder cadence.",
      },
    ],
  }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const totalOutstanding = companies
    .filter((c) => c.paymentStatus !== "Paid")
    .reduce((s, c) => s + c.invoiceAmount, 0);
  const overdue = companies.filter((c) => c.paymentStatus === "Overdue").length;
  const paid = companies.filter((c) => c.paymentStatus === "Paid").length;

  return (
    <>
      <TopBar
        title="Payments"
        subtitle={`HKD ${totalOutstanding.toLocaleString()} outstanding across ${companies.length - paid} invoices`}
      />
      <main className="flex-1 space-y-6 p-6">
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <KpiCard
            label="Outstanding"
            value={`HKD ${totalOutstanding.toLocaleString()}`}
            hint={`${companies.length - paid} invoices`}
            icon={CreditCard}
            tone="orange"
          />
          <KpiCard
            label="Overdue"
            value={overdue}
            hint="Requires escalation"
            icon={AlertCircle}
            tone="red"
          />
          <KpiCard
            label="Collected this quarter"
            value="HKD 184,200"
            hint="+12% vs. last quarter"
            icon={TrendingUp}
            tone="green"
          />
        </section>

        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-display text-base font-semibold text-foreground">Invoices</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Due</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Reminders</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {companies.map((c, i) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <Link
                      to="/clients/$id"
                      params={{ id: c.id }}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {c.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      INV-2026-{(100 + i).toString().padStart(4, "0")}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-medium tabular-nums">
                    HKD {c.invoiceAmount.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(c.arDueDate)}</td>
                  <td className="px-5 py-3">
                    <StatusPill
                      tone={
                        c.paymentStatus === "Paid"
                          ? "green"
                          : c.paymentStatus === "Pending"
                            ? "yellow"
                            : "red"
                      }
                    >
                      {c.paymentStatus}
                    </StatusPill>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {c.paymentStatus === "Paid" ? "—" : `${(i % 3) + 1} sent`}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {c.paymentStatus !== "Paid" && (
                      <button className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                        Send reminder
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
