import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { getAnnualReturnWorkViews } from "@/features/annual-return/server-fns";
import type { WorkViewKey } from "@/features/annual-return/work-views";

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
  component: TodayRoute,
});

function TodayRoute() {
  const { dataMode } = Route.useRouteContext();
  const [active, setActive] = useState<WorkViewKey>("chaseToday");

  const viewsQuery = useQuery({
    queryKey: ["annual-return", "work-views"],
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
        <p className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          無法載入今日工作。這不代表沒有工作，請直接開啟案件板。
        </p>
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
            onClick={() => setActive(view.definition.key)}
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
            <p className="p-4 text-sm text-status-yellow">{current.definition.unavailableReason}</p>
          ) : current.rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {viewsQuery.isPending ? "載入中…" : "現時沒有這一類工作。"}
            </p>
          ) : (
            <div className="divide-y">
              {current.rows.map((row) => (
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
                  <p className="truncate text-muted-foreground">{row.blocker}</p>
                  <p
                    className={row.daysRemaining < 0 ? "text-status-red" : "text-muted-foreground"}
                  >
                    {row.daysRemaining < 0
                      ? `逾期 ${-row.daysRemaining} 天`
                      : `尚餘 ${row.daysRemaining} 天`}
                  </p>
                  <Link
                    className="justify-self-start rounded-md border px-3 py-2 text-sm md:justify-self-end"
                    to="/annual-returns/$id"
                    params={{ id: row.caseId }}
                  >
                    開啟案件
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
