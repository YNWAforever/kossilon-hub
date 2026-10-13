import { ProductionPaymentReview } from "@/features/annual-return/components/production-payment-review";
import { type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format-date";

import {
  type AnnualReturnCase,
  type AnnualReturnPaymentStatus,
  getPacketStatus,
  getReadinessScore,
  useAnnualReturnCases,
} from "../lib/annual-return-store";
import {
  getCurrentPaymentProof,
  getPaymentProofsForCase,
  useClientPortalSnapshot,
  type ClientPortalPaymentProof,
} from "../lib/client-portal-store";

export const Route = createFileRoute("/payments")({
  component: PaymentsRoute,
});

const paymentLabels: Record<AnnualReturnPaymentStatus, string> = {
  pending: "待付款",
  paid: "已付款",
  overdue: "逾期未付",
};

function PaymentsRoute() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? <DemoPaymentsRoute /> : <ProductionPaymentsRoute />;
}

// Exported for -payments.interaction.test.tsx. The dataMode branch lives in the
// parent PaymentsRoute, so this component never touches Route itself.
export function ProductionPaymentsRoute() {
  const actor = Route.useRouteContext().actor;
  return (
    <ProductionPaymentReview
      canBulk={actor?.active === true && (actor.role === "Admin" || actor.role === "Manager")}
      actorScope={JSON.stringify(
        actor ? [actor.authUserId, actor.userId, actor.role, actor.teamId, actor.active] : null,
      )}
    />
  );
}

function DemoPaymentsRoute() {
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="文件與付款" title="付款" />
      <p
        className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text"
        role="status"
      >
        唯讀示範。付款證明須在正式環境上載及覆核。
      </p>

      <section className="rounded-lg border bg-card">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_120px_120px_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(200px,1fr)] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>公司</span>
          <span>負責同事／到期日</span>
          <span>付款</span>
          <span>目前證明</span>
          <span>覆核結果</span>
          <span>操作</span>
        </div>

        <div className="divide-y">
          {cases.map((caseItem) => (
            <PaymentReviewRow
              key={caseItem.id}
              caseItem={caseItem}
              proof={getCurrentPaymentProof(caseItem.id, snapshot)}
              history={getPaymentProofsForCase(caseItem.id, snapshot)}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

type PaymentReviewRowProps = {
  caseItem: AnnualReturnCase;
  proof?: ClientPortalPaymentProof;
  history: ClientPortalPaymentProof[];
};

function PaymentReviewRow({ caseItem, proof, history }: PaymentReviewRowProps) {
  const isClosed = caseItem.status === "filed" || getPacketStatus(caseItem) === "accepted";
  const previousProofs = history.filter((candidate) => candidate.id !== proof?.id);

  return (
    <div className="grid grid-cols-2 gap-3 px-4 py-4 text-sm lg:grid-cols-[minmax(0,1.4fr)_120px_120px_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(200px,1fr)] lg:items-start">
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
          公司
        </p>
        <p className="truncate font-medium">{caseItem.companyName}</p>
        <p className="truncate text-muted-foreground">{caseItem.contactName}</p>
      </div>
      <Field
        label="負責同事／到期日"
        value={
          <>
            <p>{caseItem.owner}</p>
            <p className="text-xs text-muted-foreground">到期日 {formatDate(caseItem.dueDate)}</p>
          </>
        }
      />
      <Field
        label="付款"
        value={
          <>
            <p
              className={
                caseItem.paymentStatus === "overdue"
                  ? "font-medium text-red-700"
                  : caseItem.paymentStatus === "paid"
                    ? "text-green-700"
                    : undefined
              }
            >
              {paymentLabels[caseItem.paymentStatus]}
            </p>
            <p className="text-xs text-muted-foreground">
              案件完成度 {getReadinessScore(caseItem)}%
            </p>
          </>
        }
      />
      <ProofCell proof={proof} previousProofs={previousProofs} />
      <ReviewOutcome proof={proof} closed={isClosed} />

      <div className="col-span-2 min-w-0 lg:col-span-1">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
          操作
        </p>
        {isClosed && (!proof || proof.status === "rejected") ? (
          // A closed case takes no new proof. A greyed-out button with no reason
          // read as broken; say why there is nothing to do.
          <p className="text-sm text-muted-foreground">
            {caseItem.status === "filed" ? "周年申報已遞交" : "交件套件已接納"}，毋須付款證明。
          </p>
        ) : (
          // The demo is read-only (docs/adr/0001-demo-mode-is-read-only.md): the
          // action is shown so the workflow reads true, but it is disabled and the
          // page says why once, rather than each click answering with a warning.
          <div className="flex flex-wrap gap-2">
            {!proof ? (
              <DemoAction label={`為 ${caseItem.companyName} 上載付款證明`}>上載證明</DemoAction>
            ) : proof.status === "rejected" ? (
              <DemoAction label={`為 ${caseItem.companyName} 重新上載付款證明`}>
                重新上載
              </DemoAction>
            ) : proof.status === "pending-review" ? (
              <>
                <DemoAction label={`接納 ${caseItem.companyName} 的付款證明`}>接納</DemoAction>
                <DemoAction label={`退回 ${caseItem.companyName} 的付款證明`}>退回</DemoAction>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">付款證明毋須進一步處理。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DemoAction({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Button aria-label={label} disabled type="button">
      {children}
    </Button>
  );
}

function ProofCell({
  proof,
  previousProofs,
}: {
  proof?: ClientPortalPaymentProof;
  previousProofs: ClientPortalPaymentProof[];
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        目前證明
      </p>
      {proof ? (
        <>
          <p className="truncate font-medium">{proof.filename}</p>
          <p className="text-muted-foreground">{`上載者：${proof.uploadedBy}`}</p>
        </>
      ) : (
        <p className="text-muted-foreground">未有上載證明</p>
      )}
      {previousProofs.length > 0 ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {`記錄：${previousProofs.map((candidate) => candidate.filename).join("、")}`}
        </p>
      ) : null}
    </div>
  );
}

function ReviewOutcome({ proof, closed }: { proof?: ClientPortalPaymentProof; closed: boolean }) {
  const label = proof ? paymentProofStatusLabel(proof.status) : closed ? "毋須提供" : "等待證明";

  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        覆核結果
      </p>
      <p className="font-medium">{proof?.reviewSummary ?? label}</p>
      {proof?.reviewReasonLabel ? (
        <p className="text-muted-foreground">{proof.reviewReasonLabel}</p>
      ) : null}
      {proof?.reviewNote ? <p className="text-muted-foreground">{proof.reviewNote}</p> : null}
      {proof?.reviewedAt ? (
        <p className="text-xs text-muted-foreground">{`覆核時間：${formatDateTime(proof.reviewedAt)}`}</p>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <div className="text-sm leading-5">{value}</div>
    </div>
  );
}

function paymentProofStatusLabel(status: ClientPortalPaymentProof["status"]): string {
  return {
    "pending-review": "待覆核",
    accepted: "已接納",
    rejected: "已退回",
    superseded: "已被取代",
  }[status];
}
