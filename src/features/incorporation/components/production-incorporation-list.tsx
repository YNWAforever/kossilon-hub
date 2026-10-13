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
import { listIncorporationCases } from "../server-fns";
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

  const casesQuery = useQuery({
    queryKey: ["incorporation-cases"],
    queryFn: () => listIncorporationCases(),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });

  if (casesQuery.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
        載入公司註冊案件中
      </div>
    );
  }

  if (casesQuery.isError) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="案件與客戶" title="公司註冊" />
        <p role="alert" className="text-sm text-destructive">
          公司註冊案件資料暫時無法載入，請稍後再試。
        </p>
      </main>
    );
  }

  const cases = casesQuery.data ?? [];

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

      <section className="rounded-lg border bg-card p-4">
        <div className="divide-y">
          {cases.map((incorporationCase) => (
            <div
              key={incorporationCase.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <span className="min-w-0 truncate font-medium">
                {incorporationCase.proposedCompanyNameEn}
              </span>
              <StatusPill tone={statusTone[incorporationCase.status]}>
                {INCORPORATION_STATUS_LABELS[incorporationCase.status]}
              </StatusPill>
              {incorporationCase.status !== "Completed" ? (
                <DeadlinePill dueDate={incorporationCase.targetCompletionDate} />
              ) : null}
              <span className="text-muted-foreground">{incorporationCase.ownerName}</span>
              <Button asChild size="sm">
                <Link to="/incorporation/$id" params={{ id: incorporationCase.id }}>
                  開啟
                </Link>
              </Button>
            </div>
          ))}
          {cases.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">尚未有公司註冊案件。</p>
          ) : null}
        </div>
      </section>

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
            void navigate({ to: "/incorporation/$id", params: { id: caseId } });
          }}
        />
      ) : null}
    </main>
  );
}
