import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { getOperationsHealth } from "@/features/operations/server-fns";
import type { MaintenanceHealthState } from "@/features/operations/health";
import type { JobQueueDepth } from "@/features/operations/repository";

/**
 * 系統運作 — whether the parts of the product that run without a person are
 * running at all.
 *
 * Every other screen reads tables a human writes to, so a five-minute schedule
 * that stopped firing leaves all of them looking completely normal. This is the
 * only screen where an absence of data is itself the finding, and it says so in
 * words rather than leaving a blank panel to be read as reassurance.
 */

export const Route = createFileRoute("/operations")({
  component: OperationsRoute,
});

const STATE_LABEL: Record<MaintenanceHealthState, string> = {
  "never-observed": "從未觀察到執行",
  stale: "排程已停止",
  failing: "最近一次執行失敗",
  degraded: "部分環節失敗",
  healthy: "正常",
};

// `never-observed` is amber, not grey and not green. It is an unknown, and an
// unknown about the one subsystem nobody watches is worth a colour.
const STATE_TONE: Record<MaintenanceHealthState, string> = {
  "never-observed": "bg-status-yellow-soft text-status-yellow",
  stale: "bg-status-red-soft text-status-red",
  failing: "bg-status-red-soft text-status-red",
  degraded: "bg-status-yellow-soft text-status-yellow",
  healthy: "bg-status-green-soft text-status-green",
};

function QueueRow({ label, depth }: { label: string; depth: JobQueueDepth }) {
  return (
    <tr className="border-t">
      <td className="px-4 py-2">{label}</td>
      <td className="px-4 py-2 tabular-nums">{depth.pending}</td>
      <td className="px-4 py-2 tabular-nums">{depth.dueNow}</td>
      <td className="px-4 py-2 tabular-nums">{depth.processing}</td>
      <td className="px-4 py-2 tabular-nums">{depth.failed}</td>
      <td className="px-4 py-2 text-muted-foreground">
        {/* A depth alone cannot tell a busy queue from a stuck one. */}
        {depth.oldestPendingAt ? depth.oldestPendingAt.slice(0, 16).replace("T", " ") : "—"}
      </td>
    </tr>
  );
}

function OperationsRoute() {
  const { dataMode } = Route.useRouteContext();

  const healthQuery = useQuery({
    queryKey: ["operations", "health"],
    queryFn: () => getOperationsHealth(),
    enabled: dataMode === "production",
    retry: false,
  });

  if (dataMode !== "production") {
    return (
      <main className="flex-1 space-y-4 p-6">
        <PageHeader eyebrow="Operations" title="系統運作" />
        <p className="text-sm text-muted-foreground">
          系統運作讀取正式資料。示範模式沒有排程，也沒有可讀取的執行紀錄。
        </p>
      </main>
    );
  }

  const view = healthQuery.data;

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title="系統運作" />

      {healthQuery.error ? (
        <p className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          無法載入系統運作狀態。這不代表排程正常——這個畫面本身讀不到，就無從判斷。
        </p>
      ) : null}

      {view ? (
        <>
          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold">五分鐘排程</h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${STATE_TONE[view.maintenance.state]}`}
              >
                {STATE_LABEL[view.maintenance.state]}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{view.maintenance.summary}</p>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">最後一次執行</dt>
                <dd className="tabular-nums">
                  {view.maintenance.lastRunAt?.slice(0, 16).replace("T", " ") ?? "從未"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">最後一次成功</dt>
                {/* "從未成功" and "從未執行" are different facts and are shown as
                    different words. */}
                <dd className="tabular-nums">
                  {view.maintenance.lastSuccessAt?.slice(0, 16).replace("T", " ") ??
                    (view.maintenance.lastRunAt ? "從未成功" : "從未")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">容許延遲</dt>
                <dd className="tabular-nums">
                  {Math.round(view.maintenance.toleranceSeconds / 60)} 分鐘
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border bg-card">
            <div className="border-b p-4">
              <h2 className="text-base font-semibold">工作隊列</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                等待排程處理的工作。「最舊一件」比數量更能分辨隊列是繁忙還是卡住。
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">隊列</th>
                    <th className="px-4 py-2 font-medium">待處理</th>
                    <th className="px-4 py-2 font-medium">已到期</th>
                    <th className="px-4 py-2 font-medium">處理中</th>
                    <th className="px-4 py-2 font-medium">失敗</th>
                    <th className="px-4 py-2 font-medium">最舊一件</th>
                  </tr>
                </thead>
                <tbody>
                  <QueueRow label="文件掃描" depth={view.queues.documentScans} />
                  <QueueRow label="文件分析" depth={view.queues.documentAnalysis} />
                  <QueueRow label="訊息派送" depth={view.queues.notifications} />
                </tbody>
              </table>
            </div>
            <p className="border-t px-4 py-3 text-sm text-muted-foreground">
              已批准但未能交出的套件：
              <span className="tabular-nums"> {view.queues.handoffsAwaitingTransmission}</span>
              。這不是故障，是缺少外部交件連接器。
            </p>
          </section>

          <section className="rounded-lg border bg-card">
            <div className="border-b p-4">
              <h2 className="text-base font-semibold">已停用的功能</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                以下功能在這個部署上不會運作。它們不是故障，也不會自行恢復。
              </p>
            </div>
            <ul className="divide-y">
              {view.blockedIntegrations.map((integration) => (
                <li className="space-y-1 p-4" key={integration.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{integration.capability}</span>
                    {integration.blocksRelease ? (
                      <span className="rounded-full bg-status-red-soft px-2 py-0.5 text-xs text-status-red">
                        阻擋交件
                      </span>
                    ) : null}
                    <code className="text-xs text-muted-foreground">{integration.id}</code>
                  </div>
                  <p className="text-sm text-muted-foreground">{integration.effect}</p>
                  <p className="text-sm">現時做法：{integration.pilotFallback}</p>
                  <p className="text-sm text-muted-foreground">需要：{integration.clearedBy}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border bg-card">
            <div className="border-b p-4">
              <h2 className="text-base font-semibold">最近的排程執行</h2>
            </div>
            {view.recentRuns.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                沒有任何執行紀錄。這是空白，不是「一切正常」。
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">排定時間</th>
                      <th className="px-4 py-2 font-medium">結果</th>
                      <th className="px-4 py-2 font-medium">耗時</th>
                      <th className="px-4 py-2 font-medium">觸發</th>
                      <th className="px-4 py-2 font-medium">失敗環節</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.recentRuns.map((entry) => (
                      <tr className="border-t" key={entry.id}>
                        <td className="px-4 py-2 tabular-nums">
                          {entry.scheduledFor.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="px-4 py-2">{entry.outcome}</td>
                        <td className="px-4 py-2 tabular-nums">{entry.durationMs} ms</td>
                        <td className="px-4 py-2">
                          {entry.triggerSource === "scheduled" ? "排程" : "人手"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {entry.failedPasses.length > 0 ? entry.failedPasses.join("、") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
