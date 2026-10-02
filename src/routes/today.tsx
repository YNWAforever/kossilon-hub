import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import {
  getAnnualReturnWorkPage,
  getAnnualReturnWorkMetrics,
} from "@/features/annual-return/server-fns";
import { WORK_VIEWS, type WorkViewKey } from "@/features/annual-return/work-views";
import { dailyViewSearch, dailyReturnPath } from "@/features/annual-return/daily-view-state";

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
  validateSearch: (
    input: SearchSchemaInput & { view?: unknown; q?: unknown; sort?: unknown; cursor?: unknown },
  ) => dailyViewSearch(input),
  component: TodayRoute,
});

function TodayRoute() {
  const { dataMode, actor } = Route.useRouteContext();
  const search = Route.useSearch();
  const active = search.view;
  const navigate = useNavigate({ from: "/today" });
  const setActive = (view: WorkViewKey) =>
    void navigate({ search: { ...search, view, cursor: undefined }, replace: true });

  const viewsQuery = useQuery({
    queryKey: [
      "annual-return",
      "work-views",
      actor?.authUserId,
      actor?.userId,
      actor?.role,
      actor?.teamId,
      actor?.active,
      search,
    ],
    queryFn: () => getAnnualReturnWorkPage({ data: { ...search, limit: 50 } }),
    enabled: dataMode === "production",
    retry: false,
  });
  const metricsQuery = useQuery({
    queryKey: ["annual-return", "work-metrics", actor, search.q],
    queryFn: () => getAnnualReturnWorkMetrics({ data: { q: search.q } }),
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

  const current = viewsQuery.data
    ? { definition: WORK_VIEWS.find((v) => v.key === active)!, rows: viewsQuery.data.rows }
    : undefined;
  const rows = viewsQuery.data?.rows ?? [];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="日常工作" title="今日工作" />

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          搜尋今日工作
          <input
            className="min-h-11 rounded-md border px-3"
            value={search.q}
            onChange={(event) =>
              void navigate({
                search: { ...search, q: event.target.value, cursor: undefined },
                replace: true,
              })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          排列
          <select
            className="min-h-11 rounded-md border px-3"
            value={search.sort}
            onChange={(event) =>
              void navigate({
                search: {
                  ...search,
                  sort: event.target.value as "deadline" | "company",
                  cursor: undefined,
                },
                replace: true,
              })
            }
          >
            <option value="deadline">限期先後</option>
            <option value="company">公司名稱</option>
          </select>
        </label>
      </div>
      {viewsQuery.isPending ? (
        <p role="status" aria-live="polite">
          正在載入今日工作…
        </p>
      ) : null}

      {viewsQuery.error ? (
        <p
          role="alert"
          className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow"
        >
          無法載入今日工作。這不代表沒有工作，請直接開啟案件板。
          <button
            className="ml-3 min-h-11 rounded-md border px-3"
            onClick={() => void viewsQuery.refetch()}
          >
            重新載入
          </button>
        </p>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label="今日工作分類">
        {WORK_VIEWS.map((definition) => (
          <button
            key={definition.key}
            aria-pressed={definition.key === active}
            className={`min-h-11 rounded-md border px-3 py-2 text-sm ${
              definition.key === active ? "bg-primary text-primary-foreground" : ""
            }`}
            onClick={() => setActive(definition.key)}
            type="button"
          >
            {definition.label}
            {/* A count is only shown for a view that can actually count. An
                unreleased view showing "0" would be a claim it cannot make. */}
            {definition.released && metricsQuery.data
              ? ` (${metricsQuery.data[definition.key]})`
              : ""}
          </button>
        ))}
      </nav>
      {metricsQuery.isError ? (
        <p role="alert">
          工作總數未能載入；已顯示列表不是全範圍總數。
          <button className="min-h-11 px-3" onClick={() => void metricsQuery.refetch()}>
            重試總數
          </button>
        </p>
      ) : null}

      {current ? (
        <section className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <h2 className="text-base font-semibold">{current.definition.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{current.definition.description}</p>
          </div>

          {!current.definition.released ? (
            <p className="p-4 text-sm text-status-yellow">{current.definition.unavailableReason}</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {search.q
                ? "此搜尋沒有符合的工作。可清除搜尋或選擇另一分類。"
                : "現時沒有這一類工作。"}
            </p>
          ) : (
            <div className="divide-y">
              {rows.map((row) => (
                <div
                  key={row.caseId}
                  className="grid gap-2 p-4 text-sm md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.companyName}</p>
                    <p className="text-xs text-muted-foreground">
                      {`${row.returnYear} · ${row.ownerName}`}
                    </p>
                  </div>
                  {/* The reason this row is here, named. */}
                  <details className="text-muted-foreground">
                    <summary className="flex min-h-11 cursor-pointer items-center">
                      查看阻擋原因
                    </summary>
                    <p className="break-words py-2">{row.blocker}</p>
                  </details>
                  <p
                    className={row.daysRemaining < 0 ? "text-status-red" : "text-muted-foreground"}
                  >
                    {row.daysRemaining < 0
                      ? `逾期 ${-row.daysRemaining} 天`
                      : `尚餘 ${row.daysRemaining} 天`}
                  </p>
                  <Link
                    className="inline-flex min-h-11 items-center justify-self-start rounded-md border px-3 py-2 text-sm md:justify-self-end"
                    to="/annual-returns/$id"
                    params={{ id: row.caseId }}
                    search={{ returnTo: dailyReturnPath(search) }}
                  >
                    開啟案件
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {search.cursor ? (
          <button
            className="min-h-11 rounded border px-3"
            onClick={() => void navigate({ search: { ...search, cursor: undefined } })}
          >
            回第一頁工作
          </button>
        ) : null}
        {viewsQuery.data?.nextCursor ? (
          <button
            className="min-h-11 rounded border px-3"
            onClick={() =>
              void navigate({ search: { ...search, cursor: viewsQuery.data!.nextCursor! } })
            }
          >
            下一頁工作
          </button>
        ) : null}
      </div>
    </main>
  );
}
