import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { useRetainedPage } from "@/lib/use-retained-page";
import type { AuthenticatedActor } from "@/features/auth/types";
import { WORK_VIEWS } from "@/features/annual-return/work-views";
import { listDailyWorkPage, getDailyAnnualReturnMetrics } from "../server-fns";
import { dailyInput, dailyWorkReturnPath, type DailyWorkSearch } from "../view-state";
import type { DailyWorkSource } from "../types";
const labels: Record<DailyWorkSource, string> = {
  annual_return: "周年申報",
  incorporation: "公司註冊",
  corporate_change_request: "公司變更",
};
const entries: Record<DailyWorkSource, string> = {
  annual_return: "/annual-returns",
  incorporation: "/incorporation",
  corporate_change_request: "/corporate-changes",
};
export function DailyWorkScreen({
  actor,
  search,
  onSearchChange,
}: {
  actor?: AuthenticatedActor;
  search: DailyWorkSearch;
  onSearchChange: (s: DailyWorkSearch) => void;
}) {
  const input = dailyInput(search),
    query = useQuery({
      queryKey: ["daily-work", actor, input],
      queryFn: () => listDailyWorkPage({ data: input }),
      retry: false,
    });
  const metrics = useQuery({
    queryKey: ["daily-work", "annual-metrics", actor, search.q, search.scope, search.companyId],
    queryFn: () =>
      getDailyAnnualReturnMetrics({
        data: { q: search.q, scope: search.scope, companyId: search.companyId },
      }),
    enabled: search.sourceType === "annual_return",
    retry: false,
  });
  const page = useRetainedPage(
    JSON.stringify([actor, { ...input, cursor: undefined }]),
    query.data,
  );
  const change = (patch: Partial<DailyWorkSearch>) =>
    onSearchChange({ ...search, ...patch, cursor: undefined, anchor: undefined });
  const field = "min-h-11 max-w-full rounded-md border bg-background px-3";
  return (
    <main className="min-w-0 flex-1 space-y-5 p-4 md:p-6">
      <PageHeader
        eyebrow="日常工作"
        title="今日工作"
        subtitle="從授權的周年申報、註冊及公司變更中找待辦；下一步只連到原安全流程。"
      />
      <section className="flex flex-wrap gap-3" aria-label="每日工作篩選">
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          搜尋今日工作
          <input
            className={field}
            value={search.q}
            onChange={(e) => change({ q: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          工作範圍
          <select
            className={field}
            value={search.scope}
            onChange={(e) => change({ scope: e.target.value as "mine" | "team" })}
          >
            <option value="mine">我的未完成工作</option>
            {actor?.role === "Admin" || actor?.role === "Manager" ? (
              <option value="team">
                {actor.role === "Admin" ? "全部授權工作" : "全隊未完成工作"}
              </option>
            ) : null}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          業務來源
          <select
            className={field}
            value={search.sourceType}
            onChange={(e) =>
              change({ sourceType: e.target.value as DailyWorkSearch["sourceType"], view: "all" })
            }
          >
            <option value="all">全部已納入來源</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          排列
          <select
            className={field}
            value={search.sort}
            onChange={(e) => change({ sort: e.target.value as "deadline" | "company" })}
          >
            <option value="deadline">限期先後</option>
            <option value="company">公司名稱</option>
          </select>
        </label>
      </section>
      {search.sourceType === "annual_return" ? (
        <>
          <nav className="flex flex-wrap gap-2" aria-label="今日工作分類">
            <button
              className={field}
              aria-pressed={search.view === "all"}
              onClick={() => change({ view: "all" })}
            >
              全部周年申報工作
            </button>
            {WORK_VIEWS.map((v) => (
              <button
                key={v.key}
                className={field}
                aria-pressed={search.view === v.key}
                onClick={() => change({ view: v.key })}
              >
                {v.label}
                {metrics.data && !metrics.isError ? " (" + metrics.data[v.key] + ")" : ""}
              </button>
            ))}
          </nav>
          {search.view !== "all" ? (
            <p className="text-sm text-muted-foreground">
              {WORK_VIEWS.find((v) => v.key === search.view)?.description}
            </p>
          ) : null}
          {metrics.isError ? (
            <p role="alert">
              分類總數未能載入，不能以此頁筆數代替。
              <button className={field} onClick={() => void metrics.refetch()}>
                重試總數
              </button>
            </p>
          ) : null}
        </>
      ) : null}
      {query.isPending ? <p role="status">正在載入今日工作…</p> : null}
      {query.isError ? (
        <p role="alert" className="rounded border p-3">
          無法載入今日工作；若有舊資料，只代表上次成功結果，這不代表沒有工作。
          <button className={field} onClick={() => void query.refetch()}>
            重新載入
          </button>
          <button
            className={field}
            onClick={() => onSearchChange({ ...search, cursor: undefined })}
          >
            回第一頁工作
          </button>
        </p>
      ) : null}
      {page ? (
        <>
          {page.partial ? (
            <p role="alert" className="rounded border p-3">
              未能完整取得全部業務來源；可用工作仍在下方，其餘總數未知。
              <button className={field} onClick={() => void query.refetch()}>
                重試來源
              </button>
            </p>
          ) : null}
          <ul className="flex flex-wrap gap-3 text-sm" aria-label="來源覆蓋">
            {page.sources.map((s) => (
              <li key={s.sourceType}>
                {labels[s.sourceType]} ·{" "}
                {s.status === "available"
                  ? "符合 " + s.total + " 項"
                  : "總數未知；" + (s.reason ?? "此業務尚未納入")}{" "}
                {s.supportId ? <span>支援編號 {s.supportId}</span> : null}{" "}
                <a
                  className="inline-flex min-h-11 items-center underline"
                  href={entries[s.sourceType]}
                >
                  原業務入口
                </a>
              </li>
            ))}
          </ul>
          <p className="text-sm" aria-live="polite">
            {page.partial
              ? page.sources.some((s) => s.status === "available")
                ? "可用來源合計 " + page.total
                : "尚無來源可核對；總數未知"
              : "篩選總數 " + page.total}{" "}
            · 此頁 {page.items.length} · 業務日期 {page.businessDate} · 觀察時間{" "}
            {new Date(page.observedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}
            （香港時間）
          </p>
          {search.anchor &&
          !query.isFetching &&
          !query.isError &&
          !page.items.some((r) => r.workKey === search.anchor || r.sourceId === search.anchor) ? (
            <p role="status">原工作已離開此清單，請重新選擇。</p>
          ) : null}
          <section className="divide-y rounded-lg border bg-card" aria-label="每日待辦">
            {page.items.length ? (
              page.items.map((row) => (
                <article
                  key={row.workKey}
                  className={
                    "grid min-w-0 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] " +
                    (search.anchor === row.workKey ? "outline outline-2 outline-primary" : "")
                  }
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{row.companyName}</p>
                    <p className="text-sm">
                      {labels[row.sourceType]} · {row.ownerName}
                    </p>
                    <p className="text-sm">限期：{row.dueDate ?? "未設定，請開案核對"}</p>
                  </div>
                  <details className="min-w-0">
                    <summary className="flex min-h-11 cursor-pointer items-center">
                      查看阻擋原因
                    </summary>
                    <p className="break-words py-2 text-sm">{row.blocker}</p>
                  </details>
                  {row.nextAction.enabled ? (
                    <a
                      className="inline-flex min-h-11 items-center justify-self-start rounded border px-3 focus-visible:outline focus-visible:outline-2"
                      href={
                        row.nextAction.href +
                        "?returnTo=" +
                        encodeURIComponent(dailyWorkReturnPath(search, row.workKey))
                      }
                    >
                      {row.nextAction.label}
                    </a>
                  ) : (
                    <p className="text-sm">
                      下一步暫不可用：{row.nextAction.reason ?? "請核對權限及當前證據"}
                    </p>
                  )}
                </article>
              ))
            ) : !page.partial ? (
              <p className="p-4">現時沒有這一類工作。可清除搜尋、切換業務或工作範圍。</p>
            ) : (
              <p className="p-4">可用來源暫未找到符合工作；其它來源尚未能核對。</p>
            )}
          </section>
          <div className="flex flex-wrap gap-3">
            {search.cursor ? (
              <button
                className={field}
                onClick={() => onSearchChange({ ...search, cursor: undefined })}
              >
                回第一頁工作
              </button>
            ) : null}
            {page.nextCursor ? (
              <button
                className={field}
                disabled={query.isFetching || query.isError}
                onClick={() => onSearchChange({ ...search, cursor: page.nextCursor! })}
              >
                下一頁工作
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </main>
  );
}
