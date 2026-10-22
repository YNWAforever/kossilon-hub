import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import type { StatusTone } from "@/lib/status";
import { CreateIncorporationCaseDialog } from "@/components/incorporation/create-incorporation-case-dialog";
import { listClientAssignmentOptions } from "@/features/clients/server-fns";
import { listIncorporationCasePage } from "../server-fns";
import { CaseListControls, CaseListPagination, useCaseListView } from "./case-list-controls";
import type { IncorporationStatus } from "../types";
import { INCORPORATION_STATUS_LABELS } from "../labels";

const statusTone: Record<IncorporationStatus, StatusTone> = {
  Intake: "neutral",
  "Documents pending": "yellow",
  "Ready to file": "yellow",
  "Filed with Registrar": "yellow",
  Completed: "green",
};

export function ProductionIncorporationList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const view = useCaseListView("/incorporation");

  const casesQuery = useQuery({
    queryKey: ["incorporation-cases", "page", view.query],
    queryFn: () => listIncorporationCasePage({ data: view.query }),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });

  const cases = casesQuery.data?.items ?? [];

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="案件與客戶"
        title="公司註冊"
        subtitle="新香港公司註冊受理，由開立案件至公司註冊處批核。"
        actions={
          optionsQuery.data ? (
            <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
              開始公司註冊
            </Button>
          ) : null
        }
      />

      {optionsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow-text">
          負責同事及團隊選項暫時無法載入，載入前未能開立新案件。
        </p>
      ) : null}

      <CaseListControls
        query={view.query}
        statuses={INCORPORATION_STATUS_LABELS}
        owners={optionsQuery.data?.owners ?? []}
        go={view.go}
        onRefresh={() => {
          void casesQuery.refetch();
        }}
        pending={casesQuery.isFetching}
      />
      {casesQuery.isPending ? (
        <p role="status">
          <Loader2 aria-hidden className="inline size-4 animate-spin" /> 載入公司註冊案件中
        </p>
      ) : null}
      {casesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          公司註冊案件資料暫時無法載入，請重試或重新整理列表。
        </p>
      ) : null}
      <section className="rounded-lg border bg-card p-4" aria-label="公司註冊案件">
        <div className="divide-y">
          {cases.map((incorporationCase) => (
            <div
              key={incorporationCase.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <span className="min-w-0 break-words font-medium">
                {incorporationCase.proposedCompanyNameEn}
                {incorporationCase.proposedCompanyNameZh ? (
                  <span className="block text-muted-foreground">
                    {incorporationCase.proposedCompanyNameZh}
                  </span>
                ) : null}
              </span>
              <StatusPill tone={statusTone[incorporationCase.status]}>
                {INCORPORATION_STATUS_LABELS[incorporationCase.status]}
              </StatusPill>
              {incorporationCase.status !== "Completed" ? (
                <DeadlinePill dueDate={incorporationCase.targetCompletionDate} />
              ) : null}
              <span className="text-muted-foreground">{incorporationCase.ownerName}</span>
              <Button asChild size="sm">
                <Link
                  to="/incorporation/$id"
                  params={{ id: incorporationCase.id }}
                  search={{ returnTo: view.returnTo }}
                >
                  開啟
                </Link>
              </Button>
            </div>
          ))}
          {!casesQuery.isPending && !casesQuery.isError && cases.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">沒有符合篩選的公司註冊案件。</p>
          ) : null}
        </div>
      </section>
      <CaseListPagination
        query={view.query}
        nextCursor={casesQuery.data?.nextCursor ?? null}
        go={view.go}
        pending={casesQuery.isFetching}
      />

      {optionsQuery.data ? (
        <CreateIncorporationCaseDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          owners={optionsQuery.data.owners}
          teams={optionsQuery.data.teams}
          isLoading={false}
          hasError={false}
          onCreated={(caseId) => {
            void queryClient.invalidateQueries({ queryKey: ["incorporation-cases"] });
            void navigate({
              to: "/incorporation/$id",
              params: { id: caseId },
              search: { returnTo: view.returnTo },
            });
          }}
        />
      ) : null}
    </main>
  );
}
