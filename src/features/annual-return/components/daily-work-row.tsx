import { Link } from "@tanstack/react-router";
import type { WorkViewKey, WorkViewRow } from "../work-views";
import { operationalActionFor } from "@/features/runtime/operational-copy";

export function DailyWorkRow({ row, viewKey }: { row: WorkViewRow; viewKey: WorkViewKey }) {
  const action = operationalActionFor(viewKey, row);
  const hash = action.href?.split("#", 2)[1];
  return (
    <article className="grid min-w-0 gap-3 p-4 text-sm md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <Link
          className="font-medium underline-offset-2 hover:underline focus-visible:underline"
          to="/annual-returns/$id"
          params={{ id: row.caseId }}
        >
          {row.companyName}
        </Link>
        <p className="text-xs text-muted-foreground">
          {row.returnYear} · {row.ownerName}
        </p>
      </div>
      <div className="min-w-0">
        <p className="break-words text-muted-foreground">{row.blocker}</p>
        <p className={row.daysRemaining < 0 ? "text-status-red" : "text-muted-foreground"}>
          {row.daysRemaining < 0 ? `逾期 ${-row.daysRemaining} 天` : `尚餘 ${row.daysRemaining} 天`}
        </p>
      </div>
      <div data-mobile-action className="min-w-0 md:justify-self-end">
        {hash ? (
          action.kind === "document-review" ? (
            <Link
              className="inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm font-medium"
              to="/documents"
              search={{ caseId: row.caseId }}
              hash={hash}
              aria-label={`${action.label}：${row.companyName}（${row.returnYear}）`}
            >
              {action.label}
            </Link>
          ) : (
            <Link
              className="inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm font-medium"
              to="/annual-returns/$id"
              params={{ id: row.caseId }}
              hash={hash}
              aria-label={`${action.label}：${row.companyName}（${row.returnYear}）`}
            >
              {action.label}
            </Link>
          )
        ) : (
          <p role="status" className="text-sm text-status-yellow">
            {action.disabledReason}
          </p>
        )}
      </div>
    </article>
  );
}
