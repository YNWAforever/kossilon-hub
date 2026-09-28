import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { getAnnualReturnWorkViews } from "@/features/annual-return/server-fns";
import { annualReturnQueryKeys } from "@/features/annual-return/query-keys";
import type { WorkViewKey } from "@/features/annual-return/work-views";
import { DailyWorkRow } from "@/features/annual-return/components/daily-work-row";

/**
 * 今日工作 — what to do now, rather than what exists.
 *
 * The board answers "which cases are there". This answers the question the
 * navigation never asked: thirteen destinations across Operations, Messaging and
 * Administration, none of them shaped like a day's work.
 *
 * Each row says why it is here in words someone can act on -- the actual
 * document names, not a count -- and a view whose capability has not shipped
 * says so rather than showing an empty list that would read as "nothing wrong".
 */

export const Route = createFileRoute("/today")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view === "newlyReceived" ||
    search.view === "awaitingMyReview" ||
    search.view === "readyToFile" ||
    search.view === "returnsAndExceptions"
      ? search.view
      : "chaseToday") as WorkViewKey,
  }),
  component: TodayRoute,
});

function TodayRoute() {
  const { dataMode } = Route.useRouteContext();
  const { view: active } = Route.useSearch();
  const navigate = Route.useNavigate();

  const viewsQuery = useQuery({
    queryKey: annualReturnQueryKeys.workViews(),
    queryFn: () => getAnnualReturnWorkViews(),
    enabled: dataMode === "production",
    retry: false,
  });

  if (dataMode !== "production") {
    return (
      <main className="flex-1 space-y-4 p-6">
        <PageHeader eyebrow="Operations" title="今日工作" />
        <p className="text-sm text-muted-foreground">
          今日工作讀取正式資料，示範模式沒有可讀取的案件。
        </p>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          瀏覽周年申報案件
        </Link>
      </main>
    );
  }

  const views = viewsQuery.data ?? [];
  const current = views.find((view) => view.definition.key === active);

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title="今日工作" />

      {viewsQuery.error ? (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow"
        >
          <p>無法載入今日工作。這不代表沒有工作，請由負責同事核對案件板。</p>
          <Link className="inline-flex rounded-md border px-3 py-2" to="/annual-returns">
            開啟案件板
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="tablist">
        {views.map((view) => (
          <button
            key={view.definition.key}
            role="tab"
            aria-selected={view.definition.key === active}
            className={`rounded-md border px-3 py-2 text-sm ${
              view.definition.key === active ? "bg-primary text-primary-foreground" : ""
            }`}
            onClick={() =>
              void navigate({ search: { view: view.definition.key }, resetScroll: false })
            }
            type="button"
          >
            {view.definition.label}
            {/* A count is only shown for a view that can actually count. An
                unreleased view showing "0" would be a claim it cannot make. */}
            {view.definition.released ? ` (${view.rows.length})` : ""}
          </button>
        ))}
      </div>

      {current ? (
        <section className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <h2 className="text-base font-semibold">{current.definition.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{current.definition.description}</p>
          </div>

          {!current.definition.released ? (
            <p className="p-4 text-sm text-status-yellow" role="status">
              {current.definition.unavailableReason} 負責同事請開啟相關案件逐項核對。
            </p>
          ) : current.rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {viewsQuery.isPending
                ? "載入中…"
                : "現時沒有這一類工作。如預期應有案件，請由負責同事在案件板核對。"}
            </p>
          ) : (
            <div className="divide-y">
              {current.rows.map((row) => (
                <DailyWorkRow key={row.caseId} row={row} viewKey={current.definition.key} />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
