import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BulkJobCenter } from "@/features/bulk-operations/components/bulk-job-center";
import { PageHeader } from "@/components/page-header";
export const Route = createFileRoute("/bulk-jobs")({ component: BulkJobsRoute });
function BulkJobsRoute() {
  const { actor, dataMode } = Route.useRouteContext();
  const [jobId, setJobId] = useState<string | null>(null);
  if (dataMode === "demo") return <main className="p-4">示範模式沒有正式批次工作。</main>;
  if (!actor?.active || !["Admin", "Manager"].includes(actor.role))
    return (
      <main className="p-4" role="alert">
        批次工作需要 Admin／Manager 權限；請聯絡 Admin 核對角色。支援編號：R18-BULK-ROLE。
      </main>
    );
  return (
    <main className="min-w-0 space-y-4 p-4 md:p-6">
      <PageHeader title="批次工作中心" subtitle="找回固定範圍、逐項回執及未確認結果。" />
      <BulkJobCenter
        key={JSON.stringify(actor)}
        actorScope={JSON.stringify(actor)}
        jobId={jobId}
        onJobChange={setJobId}
      />
    </main>
  );
}
