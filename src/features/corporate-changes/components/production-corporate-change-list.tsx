import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { CreateCorporateChangeRequestDialog } from "@/components/corporate-changes/create-corporate-change-request-dialog";
import { listCorporateChangeRequestPage } from "@/features/corporate-changes/server-fns";
import { listClientPage, listClientAssignmentOptions } from "@/features/clients/server-fns";
import {
  CaseListControls,
  CaseListPagination,
  useCaseListView,
} from "@/features/incorporation/components/case-list-controls";
import {
  CORPORATE_CHANGE_STATUS_LABELS,
  CORPORATE_CHANGE_TYPE_LABELS,
} from "@/features/corporate-changes/labels";

export function ProductionCorporateChangeList() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const view = useCaseListView("/corporate-changes");

  const requestsQuery = useQuery({
    queryKey: ["corporate-change-requests", "page", view.query],
    queryFn: () => listCorporateChangeRequestPage({ data: view.query }),
    retry: false,
  });
  const ownersQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });

  // `listClientAssignmentOptions` only returns owner/team pairs, not companies, so the
  // company picker is fed from `listClients` (the same list the client register renders).
  const clientsQuery = useQuery({
    queryKey: ["clients", "corporate-picker", companySearch],
    queryFn: () => listClientPage({ data: { q: companySearch, limit: 200 } }),
    enabled: isCreateOpen,
    retry: false,
  });

  const requests = requestsQuery.data?.items ?? [];
  const companies = (clientsQuery.data?.clients ?? []).map((client) => ({
    id: client.id,
    companyName: client.companyName,
  }));

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="案件與客戶"
        title="公司變更"
        subtitle="公司名稱變更、股份轉讓、高級人員變更及註冊辦事處變更。"
        actions={
          <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
            新增申請
          </Button>
        }
      />

      <CaseListControls
        query={view.query}
        statuses={CORPORATE_CHANGE_STATUS_LABELS}
        owners={ownersQuery.data?.owners ?? []}
        go={view.go}
        onRefresh={() => {
          void requestsQuery.refetch();
        }}
        pending={requestsQuery.isFetching}
      />
      {requestsQuery.isPending ? (
        <p role="status">
          <Loader2 aria-hidden className="inline size-4 animate-spin" /> 載入公司變更申請中
        </p>
      ) : null}
      {requestsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          公司變更申請資料暫時無法載入，請重試或重新整理列表。
        </p>
      ) : null}
      {isCreateOpen && clientsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow-text">
          公司選項暫時無法載入，載入前未能新增申請。
        </p>
      ) : null}

      <section className="overflow-x-auto rounded-lg border bg-card" aria-label="公司變更申請">
        {!requestsQuery.isPending && !requestsQuery.isError && requests.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">沒有符合篩選的公司變更申請。</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3 font-medium">公司</th>
                <th className="p-3 font-medium">類別</th>
                <th className="p-3 font-medium">狀態</th>
                <th className="p-3 font-medium">報價</th>
                <th className="p-3 font-medium">負責同事</th>
                <th className="p-3 font-medium">期限</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">
                    <Link
                      to="/corporate-changes/$id"
                      params={{ id: request.id }}
                      search={{ returnTo: view.returnTo }}
                      className="break-words underline"
                    >
                      {request.companyName}
                    </Link>
                  </td>
                  <td className="p-3">
                    {CORPORATE_CHANGE_TYPE_LABELS[request.changeType] ?? request.changeType}
                  </td>
                  <td className="p-3">
                    {CORPORATE_CHANGE_STATUS_LABELS[request.status] ?? request.status}
                  </td>
                  <td className="p-3">HKD {request.quotedFee.toLocaleString()}</td>
                  <td className="p-3">{request.ownerName ?? "未設定"}</td>
                  <td className="p-3">{request.dueDate ?? "未設定"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <CaseListPagination
        query={view.query}
        nextCursor={requestsQuery.data?.nextCursor ?? null}
        go={view.go}
        pending={requestsQuery.isFetching}
      />

      <CreateCorporateChangeRequestDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        companies={companies}
        isLoading={clientsQuery.isLoading}
        hasError={clientsQuery.isError}
        companySearch={companySearch}
        onCompanySearchChange={setCompanySearch}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ["corporate-change-requests"] });
        }}
      />
    </main>
  );
}
