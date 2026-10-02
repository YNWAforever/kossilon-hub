import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { previewChecklistTemplateMigration } from "../server-fns";
import type { ChecklistTemplate } from "../types";

/** Read-only difference preview. There is no implicit existing-case apply command. */
export function TemplateImpactPreview({ template }: { template: ChecklistTemplate }) {
  const [open, setOpen] = useState(false),
    [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const query = useQuery({
    queryKey: ["template-impact", template.id, template.revision, cursors.at(-1)],
    queryFn: () =>
      previewChecklistTemplateMigration({
        data: { id: template.id, cursor: cursors.at(-1), limit: 20 },
      }),
    enabled: open && Boolean(template.revision),
    retry: false,
  });
  return (
    <section className="mb-5 space-y-3 rounded-md border p-3" aria-label="模板生效範圍">
      <p className="text-sm">
        目前版本：{template.revision ?? "未知"}。新案件使用當時版本快照；現有案件不會自動更新。
      </p>
      <button
        type="button"
        className="rounded-md border px-3 py-2"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
      >
        現有案件版本差異預覽
      </button>
      {open ? (
        <>
          {query.isPending ? <p>正在載入差異…</p> : null}
          {query.isError ? (
            <p role="alert">
              無法載入差異，沒有執行更改。
              <button onClick={() => void query.refetch()}>重試預覽</button>
            </p>
          ) : null}
          {query.data ? (
            <>
              <p className="text-sm">
                已記錄此模板來源的案件：{query.data.total}；來源未知的舊案件：
                {query.data.unknownLegacyCases}（不推定屬於此模板）。
              </p>
              {query.data.cases.length === 0 ? (
                <p>此頁沒有已知來源案件。舊案件需人手核對來源。</p>
              ) : (
                <ul className="space-y-3">
                  {query.data.cases.map((row) => (
                    <li key={row.caseId} className="rounded-md bg-muted p-3 text-sm">
                      <p>
                        {row.companyName} · {row.returnYear} · 版本 {row.fromRevision} →{" "}
                        {row.toRevision}
                        {row.closed ? "（已鎖定）" : ""}
                      </p>
                      <p>模板新增項目：{row.added.join("、") || "沒有"}</p>
                      <p>模板移除項目：{row.removed.join("、") || "沒有"}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-muted-foreground">
                這是唯讀差異，不會刪改文件、付款或批准。要更改現有案件，須另行人手覆核逐案遷移。
              </p>
              <div className="flex gap-2">
                {cursors.length > 1 ? (
                  <button onClick={() => setCursors((x) => x.slice(0, -1))}>上一頁</button>
                ) : null}
                {query.data.nextCursor ? (
                  <button onClick={() => setCursors((x) => [...x, query.data!.nextCursor!])}>
                    下一頁
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
