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
import { businessStatusLabel, corporateChangeLabel } from "@/lib/staff-copy.zh-HK";
import type { AuthenticatedActor } from "@/features/auth/types";

import { CreateCorporateChangeRequestDialog } from "@/components/corporate-changes/create-corporate-change-request-dialog";
import { listClientPage, listClientAssignmentOptions } from "@/features/clients/server-fns";
import { listCorporateChangeRequestPage } from "../server-fns";
import { corporateChangeListPageSchema } from "../list-page";
import { CORPORATE_CHANGE_STATUSES } from "../types";
export function ProductionCorporateChangeList({
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
      businessListSearch({}, corporateChangeListPageSchema.shape.status),
    ),
    [open, setOpen] = useState(false),
    [companyQ, setCompanyQ] = useState("");
  const search = provided ?? local,
    change = onSearchChange ?? setLocal,
    { anchor, ...filters } = search;
  const requests = useQuery({
    queryKey: ["corporate-change-requests", "page", actor, search],
    queryFn: () =>
      listCorporateChangeRequestPage({
        data: corporateChangeListPageSchema.parse({ ...filters, limit: 50 }),
      }),
    retry: false,
  });
  const options = useQuery({
    queryKey: ["clients", "assignment-options", actor],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });
  const clients = useQuery({
    queryKey: ["clients", "corporate-picker", actor, companyQ],
    queryFn: () => listClientPage({ data: { q: companyQ, limit: 50 } }),
    enabled: open,
    retry: false,
  });
  const page = useRetainedPage(
    JSON.stringify([actor, { ...filters, cursor: undefined }]),
    requests.data,
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
        title="公司變更"
        subtitle="搜尋涵蓋全部授權變更案件；預設排除已完成／取消。"
        actions={
          <button
            ref={createButton}
            className="min-h-11 rounded bg-primary px-3 text-primary-foreground"
            onClick={() => setOpen(true)}
          >
            新增變更
          </button>
        }
      />
      <BusinessListControls
        search={search}
        onChange={change}
        statuses={CORPORATE_CHANGE_STATUSES}
        owners={owners}
      />
      {options.isError ? (
        <p role="status">
          負責人名單未能載入。
          <button className="min-h-11 px-3" onClick={() => void options.refetch()}>
            重試負責人名單
          </button>
        </p>
      ) : null}
      {requests.isPending ? <p role="status">正在載入變更案件…</p> : null}
      {requests.isError ? (
        <p role="alert" className="rounded border p-3">
          列表未能載入；這不代表沒有案件。
          <button className="min-h-11 rounded border px-3" onClick={() => void requests.refetch()}>
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
          !requests.isFetching &&
          !requests.isError &&
          !page.items.some((r) => r.id === anchor) ? (
            <p role="status">原案件已離開此清單，請重新選擇。</p>
          ) : null}
          <section className="divide-y rounded-lg border bg-card" aria-label="變更案件列表">
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
                    <p className="break-words font-medium">{row.companyName}</p>
                    <p className="text-sm">
                      {corporateChangeLabel(row.changeType)} · {businessStatusLabel(row.status)} ·{" "}
                      {row.ownerName}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p>限期：{row.dueDate ?? "未設定"}</p>
                    <p>
                      報價：HKD{" "}
                      {row.quotedFee.toLocaleString("zh-HK", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <Link
                    className="inline-flex min-h-11 items-center justify-self-start rounded border px-3 focus-visible:outline focus-visible:outline-2"
                    to="/corporate-changes/$id"
                    params={{ id: row.id }}
                    search={{ returnTo: businessReturnPath("/corporate-changes", search, row.id) }}
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
                disabled={requests.isFetching || requests.isError}
                onClick={() => change({ ...search, cursor: page.nextCursor! })}
              >
                下一頁
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <CreateCorporateChangeRequestDialog
        open={open}
        onOpenChange={setDialog}
        companies={(clients.data?.clients ?? []).map((c) => ({
          id: c.id,
          companyName: c.companyName,
        }))}
        isLoading={clients.isPending}
        hasError={clients.isError}
        companySearchControl={
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="corporate-picker-q">搜尋可選公司</label>
            <input
              id="corporate-picker-q"
              className="min-h-11 rounded border px-3"
              value={companyQ}
              onChange={(e) => setCompanyQ(e.target.value)}
            />
            <span>最多顯示50項；搜尋涵蓋授權公司。</span>
            {clients.isError ? (
              <button
                type="button"
                className="min-h-11 rounded border px-3"
                onClick={() => void clients.refetch()}
              >
                重試公司名單
              </button>
            ) : null}
          </div>
        }
        onCreated={(id) => {
          void client.invalidateQueries({ queryKey: ["corporate-change-requests"] });
          void navigate({
            to: "/corporate-changes/$id",
            params: { id },
            search: { returnTo: businessReturnPath("/corporate-changes", search, id) },
          });
        }}
      />
    </main>
  );
}
