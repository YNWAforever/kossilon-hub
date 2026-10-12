import { createFileRoute, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { DailyWorkScreen } from "@/features/daily-work/components/daily-work-screen";
import { dailyWorkSearch } from "@/features/daily-work/view-state";
export const Route = createFileRoute("/today")({
  validateSearch: (input: SearchSchemaInput & Record<string, unknown>) => dailyWorkSearch(input),
  component: TodayRoute,
});
export function TodayRoute() {
  const { dataMode, actor } = Route.useRouteContext(),
    search = dailyWorkSearch(Route.useSearch()),
    navigate = useNavigate({ from: "/today" });
  if (dataMode !== "production")
    return (
      <main className="min-w-0 flex-1 space-y-4 p-4 md:p-6">
        <PageHeader eyebrow="日常工作" title="今日工作" />
        <p>今日工作讀取正式資料，示範模式沒有可讀取的案件。</p>
        <a className="inline-flex min-h-11 items-center rounded border px-3" href="/annual-returns">
          瀏覽周年申報案件
        </a>
      </main>
    );
  return (
    <DailyWorkScreen
      actor={actor ?? undefined}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
