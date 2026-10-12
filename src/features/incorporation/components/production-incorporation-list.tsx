import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { BusinessListControls } from "@/components/business-list-controls";
import { useRetainedPage } from "@/lib/use-retained-page";
import {
  businessListSearch,
  businessReturnPath,
  type BusinessListSearch,
} from "@/lib/business-list";
import { businessStatusLabel } from "@/lib/staff-copy.zh-HK";
import type { AuthenticatedActor } from "@/features/auth/types";

import { CreateIncorporationCaseDialog } from "@/components/incorporation/create-incorporation-case-dialog";
import { listClientAssignmentOptions } from "@/features/clients/server-fns";
import { listIncorporationCasePage } from "../server-fns";
import { incorporationListPageSchema } from "../list-page";
import { INCORPORATION_STATUSES } from "../types";
export function ProductionIncorporationList({
  search: provided,
  onSearchChange,
  actor,
}: {
  search?: BusinessListSearch;
  onSearchChange?: (search: BusinessListSearch) => void;
  actor?: AuthenticatedActor;
} = {}) {
  const navigate = useNavigate(),
    client = useQueryClient(),
    createButton = useRef<HTMLButtonElement>(null);
  const [local, setLocal] = useState(() =>
      businessListSearch({}, incorporationListPageSchema.shape.status),
    ),
    [open, setOpen] = useState(false);
  const search = provided ?? local,
    change = onSearchChange ?? setLocal,
    { anchor, ...filters } = search;
  const cases = useQuery({
    queryKey: ["incorporation-cases", "page", actor, search],
    queryFn: () =>
      listIncorporationCasePage({
        data: incorporationListPageSchema.parse({ ...filters, limit: 50 }),
      }),
    retry: false,
  });
  const options = useQuery({
    queryKey: ["clients", "assignment-options", actor],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });
  const page = useRetainedPage(
    JSON.stringify([actor, { ...filters, cursor: undefined }]),
    cases.data,
  );
  const owners = (options.data?.owners ?? []).filter(
    (o) => !actor || actor.role === "Admin" || o.teamId === actor.teamId,
  );
  const setDialog = (value: boolean) => {
    setOpen(value);
    if (!value) requestAnimationFrame(() => createButton.current?.focus());
  };
  return (
    <main className="min-w-0 flex-1 space-y-5 p-4 md:p-6">
      <PageHeader
        eyebrow="日常工作"
        title="公司註冊"
        subtitle="預設顯示授權範圍內未完成的案件。"
        actions={
          <button
            ref={createButton}
            className="min-h-11 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50"
            disabled={!options.data}
            onClick={() => setOpen(true)}
          >
            新增註冊案件
          </button>
        }
      />
      <BusinessListControls
        search={search}
        onChange={change}
        statuses={INCORPORATION_STATUSES}
        owners={owners}
      />
      {options.isError ? (
        <p role="status">
          分派名單未能載入，暫不能建立案件。
          <button className="min-h-11 px-3" onClick={() => void options.refetch()}>
            重試分派名單
          </button>
        </p>
      ) : null}
      {cases.isPending ? <p role="status">正在載入註冊案件…</p> : null}
      {cases.isError ? (
        <p role="alert" className="rounded border p-3">
          列表未能載入；這不代表沒有案件。
          <button className="min-h-11 rounded border px-3" onClick={() => void cases.refetch()}>
            重試列表
          </button>
          <button
            className="min-h-11 px-3"
            onClick={() => change({ ...search, cursor: undefined })}
          >
            回第一頁
          </button>
        </p>
      ) : null}
      {page ? (
        <>
          <p aria-live="polite">
            篩選總數 {page.total} · 此頁 {page.items.length} · 觀察時間{" "}
            {new Date(page.observedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}
            （香港時間）
          </p>
          {anchor &&
          !cases.isFetching &&
          !cases.isError &&
          !page.items.some((r) => r.id === anchor) ? (
            <p role="status">原案件已離開此清單，請重新選擇。</p>
          ) : null}
          <section className="divide-y rounded-lg border bg-card" aria-label="註冊案件列表">
            {page.items.length ? (
              page.items.map((row) => (
                <article
                  key={row.id}
                  data-return-anchor={row.id === anchor || undefined}
                  className={
                    "grid min-w-0 gap-2 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] " +
                    (row.id === anchor ? "outline outline-2 outline-primary" : "")
                  }
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{row.proposedCompanyNameEn}</p>
                    <p className="text-sm">
                      {row.ownerName} · {businessStatusLabel(row.status)}
                    </p>
                  </div>
                  <p className="text-sm">限期：{row.dueDate ?? "未設定"}</p>
                  <Link
                    className="inline-flex min-h-11 items-center justify-self-start rounded border px-3 focus-visible:outline focus-visible:outline-2"
                    to="/incorporation/$id"
                    params={{ id: row.id }}
                    search={{ returnTo: businessReturnPath("/incorporation", search, row.id) }}
                  >
                    開啟案件
                  </Link>
                </article>
              ))
            ) : (
              <p className="p-4">此篩選沒有符合案件。可清除搜尋、切換範圍或查看歷史案件。</p>
            )}
          </section>
          <div className="flex flex-wrap gap-3">
            {search.cursor ? (
              <button
                className="min-h-11 rounded border px-3"
                onClick={() => change({ ...search, cursor: undefined })}
              >
                回第一頁
              </button>
            ) : null}
            {page.nextCursor ? (
              <button
                className="min-h-11 rounded border px-3"
                disabled={cases.isFetching || cases.isError}
                onClick={() => change({ ...search, cursor: page.nextCursor! })}
              >
                下一頁
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {options.data ? (
        <CreateIncorporationCaseDialog
          open={open}
          onOpenChange={setDialog}
          owners={owners}
          teams={options.data.teams}
          isLoading={false}
          hasError={false}
          onCreated={(id) => {
            void client.invalidateQueries({ queryKey: ["incorporation-cases"] });
            void navigate({
              to: "/incorporation/$id",
              params: { id },
              search: { returnTo: businessReturnPath("/incorporation", search, id) },
            });
          }}
        />
      ) : null}
    </main>
  );
}
