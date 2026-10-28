import { LoadingRows } from "@/components/ui/skeleton";
import { pageTitle } from "@/lib/page-title";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  createFileRoute,
  defaultStringifySearch,
  useNavigate,
  type SearchSchemaInput,
} from "@tanstack/react-router";

import { DemoUnavailable } from "@/components/demo-unavailable";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import {
  getAnnualReturnWorkPage,
  getAnnualReturnWorkMetrics,
} from "@/features/annual-return/server-fns";
import { WORK_VIEWS, type WorkViewKey } from "@/features/annual-return/work-views";
import { dailyViewSearch, dailyReturnPath } from "@/features/annual-return/daily-view-state";
import { useRetainedPage } from "@/lib/use-retained-page";
import { getOtherBusinessWorkPage } from "@/features/annual-return/work-views-other-server";

function statusTimeLabel(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "狀態時間未能判定";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")} HKT`;
}

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
  head: () => ({ meta: [{ title: pageTitle("今日工作") }] }),
  validateSearch: (
    input: SearchSchemaInput & {
      view?: unknown;
      q?: unknown;
      sort?: unknown;
      cursor?: unknown;
      otherCursor?: unknown;
    },
  ) => dailyViewSearch(input),
  component: TodayRoute,
});

function TodayRoute() {
  const { dataMode, actor } = Route.useRouteContext();
  const search = Route.useSearch();
  const active = search.view;
  const navigate = useNavigate({ from: "/today" });
  const setActive = (view: WorkViewKey) =>
    void navigate({
      search: { ...search, view, cursor: undefined, otherCursor: undefined },
      replace: true,
    });

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
  const page = useRetainedPage(
    JSON.stringify([actor, active, search.q, search.sort]),
    viewsQuery.data,
  );
  const otherWorkQuery = useQuery({
    queryKey: ["today-other-business", actor, active, search.q, search.sort, search.otherCursor],
    queryFn: () =>
      getOtherBusinessWorkPage({
        data: {
          view: active,
          q: search.q,
          sort: search.sort,
          cursor: search.otherCursor,
          limit: 25,
        },
      }),
    enabled: dataMode === "production" && Boolean(actor?.active),
    retry: false,
  });
  const otherPage = useRetainedPage(
    JSON.stringify([actor, active, search.q, search.sort]),
    otherWorkQuery.data,
  );

  if (dataMode !== "production") {
    return (
      <main className="flex-1 space-y-4 p-6">
        <PageHeader eyebrow="今日工作" title="今日工作" />
        <DemoUnavailable message="今日工作讀取正式資料，示範模式沒有可讀取的案件。" />
      </main>
    );
  }

  const annualReadBlocked = viewsQuery.isError || viewsQuery.isFetching;
  const otherReadBlocked = otherWorkQuery.isError || otherWorkQuery.isFetching;
  const current =
    page && !annualReadBlocked
      ? { definition: WORK_VIEWS.find((v) => v.key === active)!, rows: page.rows }
      : undefined;
  const rows = !annualReadBlocked ? (page?.rows ?? []) : [];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="今日工作" title="今日工作" />

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          搜尋今日工作
          <Input
            className="min-h-11"
            value={search.q}
            onChange={(event) =>
              void navigate({
                search: {
                  ...search,
                  q: event.target.value,
                  cursor: undefined,
                  otherCursor: undefined,
                },
                replace: true,
              })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          排列
          <Select
            className="min-h-11"
            value={search.sort}
            onChange={(event) =>
              void navigate({
                search: {
                  ...search,
                  sort: event.target.value as "deadline" | "company",
                  cursor: undefined,
                  otherCursor: undefined,
                },
                replace: true,
              })
            }
          >
            <option value="deadline">到期日先後</option>
            <option value="company">公司名稱</option>
          </Select>
        </label>
      </div>
      {viewsQuery.isFetching ? <LoadingRows label="正在載入今日工作…" rows={5} /> : null}

      {viewsQuery.error ? (
        <p
          role="alert"
          className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text"
        >
          無法載入今日工作。這不代表沒有工作，請直接開啟案件板。
          <Button
            className="ml-3 min-h-11"
            disabled={viewsQuery.isFetching}
            onClick={() => void viewsQuery.refetch({ cancelRefetch: false })}
          >
            重新載入
          </Button>
        </p>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label="今日工作分類">
        {WORK_VIEWS.map((definition) => (
          <Button
            key={definition.key}
            aria-pressed={definition.key === active}
            variant={definition.key === active ? "primary" : "outline"}
            className="min-h-11"
            onClick={() => setActive(definition.key)}
            type="button"
          >
            {definition.label}
            {/* A count is only shown for a view that can actually count. An
                unreleased view showing "0" would be a claim it cannot make. */}
            {definition.released &&
            !metricsQuery.isError &&
            !metricsQuery.isFetching &&
            metricsQuery.data
              ? ` (${metricsQuery.data[definition.key]})`
              : ""}
          </Button>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">
        分類括號數字為周年申報總數；其他業務分頁列於下方。
      </p>
      {metricsQuery.isError ? (
        <p role="alert">
          工作總數未能載入；已顯示列表不是全範圍總數。
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={metricsQuery.isFetching}
            onClick={() => void metricsQuery.refetch({ cancelRefetch: false })}
          >
            重試總數
          </Button>
        </p>
      ) : null}

      {current ? (
        <section className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <h2 className="text-base font-semibold">{current.definition.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{current.definition.description}</p>
          </div>

          {!current.definition.released ? (
            <p className="p-4 text-sm text-status-yellow-text">
              {current.definition.unavailableReason}
            </p>
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
                      查看阻礙事項
                    </summary>
                    <p className="break-words py-2">{row.blocker}</p>
                  </details>
                  <p
                    className={
                      row.daysRemaining < 0 ? "text-status-red-text" : "text-muted-foreground"
                    }
                  >
                    {row.daysRemaining < 0
                      ? `已逾期 ${-row.daysRemaining} 日`
                      : `尚餘 ${row.daysRemaining} 日`}
                  </p>
                  <Button asChild className="min-h-11 justify-self-start md:justify-self-end">
                    <Link
                      to="/annual-returns/$id"
                      params={{ id: row.caseId }}
                      search={{ returnTo: dailyReturnPath(search) }}
                    >
                      開啟案件
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {search.cursor ? (
          <Button
            className="min-h-11"
            onClick={() => void navigate({ search: { ...search, cursor: undefined } })}
          >
            回第一頁工作
          </Button>
        ) : null}
        {page?.nextCursor ? (
          <Button
            disabled={viewsQuery.isFetching || viewsQuery.isError}
            className="min-h-11"
            onClick={() => void navigate({ search: { ...search, cursor: page.nextCursor! } })}
          >
            下一頁工作
          </Button>
        ) : null}
      </div>
      {actor?.active ? (
        <section className="rounded-lg border bg-card" aria-label="公司註冊及公司變更工作">
          <div className="border-b p-4">
            <h2 className="font-semibold">公司註冊及公司變更</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              同一分類及搜尋範圍；期限為註冊目標完成日或變更工作的 SLA。缺少資料不代表已可交件。
            </p>
          </div>
          {otherWorkQuery.isFetching ? (
            <LoadingRows label="正在載入其他業務工作…" rows={3} />
          ) : null}
          {otherWorkQuery.isError ? (
            <p role="alert" className="p-4 text-status-yellow-text">
              公司註冊及公司變更未能載入，這不代表沒有工作。
              <Button
                className="ml-3 min-h-11"
                disabled={otherWorkQuery.isFetching}
                onClick={() => void otherWorkQuery.refetch({ cancelRefetch: false })}
              >
                重試其他業務
              </Button>
            </p>
          ) : null}
          {active === "readyToFile" ? (
            <p className="p-4 text-sm">
              公司註冊及公司變更須在個案核對交件資格；狀態標籤及文件數量不能代替批准證據。請到「等我覆核」核對負責個案。
            </p>
          ) : otherPage && !otherReadBlocked && otherPage.rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              此分類沒有符合的公司註冊或公司變更工作。
            </p>
          ) : null}
          <div className="divide-y">
            {(!otherReadBlocked ? otherPage?.rows : [])?.map((row) => {
              const label = row.business === "incorporation" ? "公司註冊" : "公司變更";
              const href =
                row.target.replace("$id", encodeURIComponent(row.caseId)) +
                defaultStringifySearch({ returnTo: dailyReturnPath(search) });
              return (
                <article
                  key={`${row.business}:${row.caseId}`}
                  className="grid gap-3 p-4 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{row.companyName}</p>
                    <p className="text-muted-foreground">
                      {label} · {row.status}
                    </p>
                    <p>
                      負責人：{row.ownerName ?? "未指定"} ·{" "}
                      {row.reviewerName ? `覆核人：${row.reviewerName}` : "覆核人未指定"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      資料狀態更新：{statusTimeLabel(row.statusAt)}
                    </p>
                  </div>
                  <div>
                    <p>{row.blocker}</p>
                    <p className="mt-1 font-medium">{row.nextStep}</p>
                    <p
                      className={
                        row.daysRemaining !== null && row.daysRemaining < 0
                          ? "text-status-red-text"
                          : "text-muted-foreground"
                      }
                    >
                      {row.dueDate
                        ? `${row.dueDate} · ${row.daysRemaining! < 0 ? `已逾期 ${-row.daysRemaining!} 日` : `尚餘 ${row.daysRemaining} 日`}`
                        : "期限未能判定"}
                    </p>
                  </div>
                  <Button
                    asChild
                    className="min-h-11 self-start justify-self-start md:justify-self-end"
                  >
                    <a href={href}>開啟{label}</a>
                  </Button>
                </article>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 p-4">
            {search.otherCursor ? (
              <Button
                className="min-h-11"
                onClick={() => void navigate({ search: { ...search, otherCursor: undefined } })}
              >
                回其他業務第一頁
              </Button>
            ) : null}
            {otherPage?.nextCursor ? (
              <Button
                className="min-h-11"
                disabled={otherWorkQuery.isFetching || otherWorkQuery.isError}
                onClick={() =>
                  void navigate({ search: { ...search, otherCursor: otherPage.nextCursor! } })
                }
              >
                下一頁其他業務
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
