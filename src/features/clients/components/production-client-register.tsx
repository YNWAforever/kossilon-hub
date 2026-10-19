import { formatDate } from "@/lib/format-date";
import { type ReactNode, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { listClientAssignmentOptions, listClientPage } from "../server-fns";
import type { ClientPaymentStatus, ClientSummary, CompanyStatus } from "../types";
import { dataOriginLabel } from "../data-origin";
import { COMPANY_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "../labels";
import { BulkSelectionToolbar } from "@/components/bulk-selection-toolbar";
import type { AuthenticatedActor } from "@/features/auth/types";
import { useRetainedPage } from "@/lib/use-retained-page";

// The tracks, six 12px gaps and row padding come to ~944px, so the register fits
// the content area of a 1280px laptop. The old 1180px floor scrolled sideways
// even at 1440px and clipped the 開啟 column.
const REGISTER_GRID_COLUMNS = "lg:grid-cols-[minmax(220px,1.6fr)_140px_120px_88px_112px_96px_64px]";
const REGISTER_GRID_MIN_WIDTH = "lg:min-w-[944px]";

const STATUS_FILTERS = ["all", "active", "inactive"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "全部",
  active: COMPANY_STATUS_LABELS.active,
  inactive: COMPANY_STATUS_LABELS.inactive,
};

const companyStatusTone: Record<CompanyStatus, StatusTone> = {
  active: "green",
  inactive: "neutral",
};

const paymentStatusTone: Record<ClientPaymentStatus, StatusTone> = {
  "Not invoiced": "neutral",
  "Payment pending": "yellow",
  "Payment received": "green",
  Overdue: "red",
};

export function ProductionClientRegister({
  allowFixtureDiagnostics = false,
  actor = null,
}: {
  allowFixtureDiagnostics?: boolean;
  actor?: AuthenticatedActor | null;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [includeFixtures, setIncludeFixtures] = useState(false);
  const [pagination, setPagination] = useState<{ key: string; cursor?: string }>({ key: "" });
  const filters = {
    includeFixtures,
    q: query,
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(teamFilter !== "all" ? { teamId: teamFilter } : {}),
  };
  const filterKey = JSON.stringify(filters),
    cursor = pagination.key === filterKey ? pagination.cursor : undefined;

  const clientsQuery = useQuery({
    queryKey: ["clients", { ...filters, cursor, actorScope: actor }],
    queryFn: () => listClientPage({ data: { ...filters, cursor, limit: 100 } }),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options", actor],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });

  const page = useRetainedPage(JSON.stringify([actor, filters]), clientsQuery.data);
  const visibleClients = page?.clients ?? [];

  function handleCreated() {
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="案件與客戶"
        title="客戶"
        actions={
          <Button disabled={!optionsQuery.data} onClick={() => setIsCreateOpen(true)}>
            新增客戶
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">
        {includeFixtures
          ? "診斷範圍：包含測試資料；測試與歷史資料不會外發。"
          : "正式範圍：排除測試資料；歷史資料只供查閱。"}
      </p>
      {actor?.active && (actor.role === "Admin" || actor.role === "Manager") ? (
        <BulkSelectionToolbar
          actorScope={JSON.stringify(actor)}
          resource="client_company"
          filters={{
            ...(query.trim() ? { q: query.trim() } : {}),
            ...(statusFilter !== "all" ? { clientStatus: statusFilter } : {}),
            ...(teamFilter !== "all" ? { teamId: teamFilter } : {}),
            includeFixtures,
          }}
          page={visibleClients.map((c) => ({ id: c.id, label: c.companyName }))}
          total={page?.total ?? null}
          pageSize={100}
          maintenanceActions={["client_maintenance"]}
        />
      ) : null}
      {allowFixtureDiagnostics ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeFixtures}
            onChange={(event) => setIncludeFixtures(event.target.checked)}
          />
          包含測試資料（Admin 診斷）
        </label>
      ) : null}

      {clientsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          客戶資料暫時無法載入，請稍後再試。
          <Button
            variant="ghost"
            className="min-h-11 px-3"
            onClick={() => void clientsQuery.refetch()}
          >
            重試客戶頁面
          </Button>
        </p>
      ) : null}

      {optionsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow-text">
          負責同事及團隊選項暫時無法載入，載入前未能新增客戶。
        </p>
      ) : null}

      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_auto_auto]">
          <Input
            className="w-full"
            aria-label="搜尋公司名稱、CR 或 BR 號碼"
            placeholder="搜尋公司名稱、CR 或 BR 號碼"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((value) => (
              <Button
                key={value}
                variant={statusFilter === value ? "primary" : "outline"}
                onClick={() => setStatusFilter(value)}
              >
                {STATUS_FILTER_LABELS[value]}
              </Button>
            ))}
          </div>
          <Select
            className="w-full"
            aria-label="按團隊篩選"
            value={teamFilter}
            onChange={(event) => setTeamFilter(event.target.value)}
          >
            <option value="all">全部團隊</option>
            {(optionsQuery.data?.teams ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="overflow-x-auto">
          <div className={REGISTER_GRID_MIN_WIDTH}>
            <div
              className={`hidden gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid ${REGISTER_GRID_COLUMNS}`}
            >
              <span>公司</span>
              <span>負責同事</span>
              <span>團隊</span>
              <span>狀態</span>
              <span>周年申報到期日</span>
              <span>付款</span>
              <span className="text-right">開啟</span>
            </div>

            <div className="divide-y">
              {visibleClients.map((client) => (
                <ClientRow key={client.id} client={client} />
              ))}
            </div>
          </div>
        </div>

        {clientsQuery.isPending ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">載入客戶中…</p>
        ) : null}

        {!clientsQuery.isPending && !clientsQuery.isError && visibleClients.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">沒有客戶符合目前的篩選條件。</p>
        ) : null}
      </section>
      <div className="flex gap-3">
        {cursor ? (
          <Button className="min-h-11" onClick={() => setPagination({ key: filterKey })}>
            回第一頁客戶
          </Button>
        ) : null}
        {page?.nextCursor ? (
          <Button
            disabled={clientsQuery.isFetching || clientsQuery.isError}
            className="min-h-11"
            onClick={() => setPagination({ key: filterKey, cursor: page.nextCursor! })}
          >
            下一頁客戶
          </Button>
        ) : null}
      </div>

      {optionsQuery.data ? (
        <ClientFormDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          options={optionsQuery.data}
          onSaved={handleCreated}
        />
      ) : null}
    </main>
  );
}

function ClientRow({ client }: { client: ClientSummary }) {
  return (
    <div className={`grid gap-3 px-4 py-4 lg:items-center ${REGISTER_GRID_COLUMNS}`}>
      <div className="min-w-0">
        <p className="truncate font-medium">{client.companyName}</p>
        <span className="text-xs text-muted-foreground">{dataOriginLabel(client.dataOrigin)}</span>
        <p className="truncate text-xs text-muted-foreground">
          CR {client.crNumber} · BR {client.brNumber}
        </p>
      </div>
      <Field label="負責同事" value={client.ownerName} />
      <Field label="團隊" value={client.teamName} />
      <Field
        label="狀態"
        value={
          <StatusPill tone={companyStatusTone[client.status]}>
            {COMPANY_STATUS_LABELS[client.status]}
          </StatusPill>
        }
      />
      <Field
        label="周年申報到期日"
        value={client.arDueDate ? formatDate(client.arDueDate) : "尚未有案件"}
      />
      <Field
        label="付款"
        value={
          client.paymentStatus ? (
            <StatusPill tone={paymentStatusTone[client.paymentStatus]}>
              {PAYMENT_STATUS_LABELS[client.paymentStatus]}
            </StatusPill>
          ) : (
            "—"
          )
        }
      />
      <div className="flex justify-start lg:justify-end">
        <Button asChild>
          <Link to="/clients/$id" params={{ id: client.id }}>
            開啟
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <div className="text-sm leading-5">{value}</div>
    </div>
  );
}
