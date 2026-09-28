import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { listAnnualReturnWorkViewPage } from "@/features/annual-return/server-fns";
import { annualReturnQueryKeys } from "@/features/annual-return/query-keys";
import { WORK_VIEWS, type WorkViewKey } from "@/features/annual-return/work-views";
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

  const [savedPage, setSavedPage] = useState<{
    view: WorkViewKey;
    cursor?: string;
    asOf?: string;
    history: { cursor?: string; asOf?: string }[];
  }>({ view: active, history: [] });
  const page = savedPage.view === active ? savedPage : { view: active, history: [] };
  const viewsQuery = useQuery({
    queryKey: annualReturnQueryKeys.workViewPage(active, page.cursor, page.asOf),
    queryFn: () =>
      listAnnualReturnWorkViewPage({
        data: { view: active, limit: 50, cursor: page.cursor, asOf: page.asOf },
      }),
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

  const current = WORK_VIEWS.find((view) => view.key === active);
  const definition = viewsQuery.data?.definition ?? current;
  const rows = viewsQuery.data?.rows ?? [];
  const total = viewsQuery.data?.total;
  const released = viewsQuery.data?.definition.released ?? active !== "readyToFile";

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
        {WORK_VIEWS.map((view) => (
          <button
            key={view.key}
            role="tab"
            aria-selected={view.key === active}
            className={`rounded-md border px-3 py-2 text-sm ${
              view.key === active ? "bg-primary text-primary-foreground" : ""
            }`}
            onClick={() => void navigate({ search: { view: view.key }, resetScroll: false })}
            type="button"
          >
            {view.label}
            {/* A count is only shown for a view that can actually count. An
                unreleased view showing "0" would be a claim it cannot make. */}
            {view.key === active && released && typeof total === "number" ? ` (${total})` : ""}
          </button>
        ))}
      </div>

      {definition ? (
        <section className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <h2 className="text-base font-semibold">{definition.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
          </div>

          {released && viewsQuery.data?.unverifiedCount ? (
            <p className="border-b p-4 text-sm text-status-yellow" role="status">
              本頁有 {viewsQuery.data.unverifiedCount}{" "}
              個候選套件無法核實，未列作可以交件。請開啟案件逐項覆核。
            </p>
          ) : null}

          {active === "readyToFile" && viewsQuery.isPending ? (
            <p className="p-4 text-sm text-muted-foreground" role="status">
              正在核實當前套件、付款及儲存檔案…
            </p>
          ) : !released ? (
            <p className="p-4 text-sm text-status-yellow" role="status">
              {definition.unavailableReason} 負責同事請開啟相關案件逐項核對。
            </p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {viewsQuery.isPending
                ? "載入中…"
                : viewsQuery.error
                  ? "載入失敗；請由負責同事在案件板核對。"
                  : active === "readyToFile" &&
                      (viewsQuery.data?.unverifiedCount || viewsQuery.data?.nextCursor)
                    ? "本頁沒有已核實可交件案件；仍有候選需核對，請繼續下一頁或逐案檢查。"
                    : "現時沒有這一類工作。如預期應有案件，請由負責同事在案件板核對。"}
            </p>
          ) : (
            <div className="divide-y">
              {rows.map((row) => (
                <DailyWorkRow key={row.caseId} row={row} viewKey={active} />
              ))}
            </div>
          )}
          {released && (page.history.length > 0 || viewsQuery.data?.nextCursor) ? (
            <div className="flex flex-wrap items-center gap-3 border-t p-4">
              {page.history.length > 0 ? (
                <button
                  className="rounded-md border px-3 py-2 text-sm"
                  onClick={() => {
                    const previous = page.history[page.history.length - 1];
                    setSavedPage({
                      view: active,
                      cursor: previous.cursor,
                      asOf: previous.asOf,
                      history: page.history.slice(0, -1),
                    });
                  }}
                  type="button"
                >
                  上一頁
                </button>
              ) : null}
              {viewsQuery.data?.nextCursor ? (
                <button
                  className="rounded-md border px-3 py-2 text-sm"
                  onClick={() =>
                    setSavedPage({
                      view: active,
                      cursor: viewsQuery.data.nextCursor ?? undefined,
                      asOf: viewsQuery.data.asOf,
                      history: [...page.history, { cursor: page.cursor, asOf: page.asOf }],
                    })
                  }
                  type="button"
                >
                  下一頁
                </button>
              ) : null}
              <span className="text-sm text-muted-foreground">
                本頁 {rows.length} 筆 ·{" "}
                {total === null ? "總數待核實" : `總數 ${total ?? "待載入"}`}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
