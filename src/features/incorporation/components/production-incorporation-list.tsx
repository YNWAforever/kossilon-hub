import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import type { StatusTone } from "@/lib/status";
import { CreateIncorporationCaseDialog } from "@/components/incorporation/create-incorporation-case-dialog";
import { listClientAssignmentOptions } from "@/features/clients/server-fns";
import { listIncorporationCases } from "../server-fns";
import type { IncorporationStatus } from "../types";

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
        Loading incorporation cases
      </div>
    );
  }

  if (casesQuery.isError) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Operations" title="Incorporation" />
        <p role="alert" className="text-sm text-destructive">
          Incorporation case data is unavailable. Try again shortly.
        </p>
      </main>
    );
  }

  const cases = casesQuery.data ?? [];

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Operations"
        title="Incorporation"
        subtitle="New-HK-company intake, from case creation through Companies Registry approval."
        actions={
          optionsQuery.data ? (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Start incorporation
            </button>
          ) : null
        }
      />

      {optionsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow">
          Owner and team options are unavailable. Starting a new case is disabled until this loads.
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
                {incorporationCase.status}
              </StatusPill>
              {incorporationCase.status !== "Completed" ? (
                <DeadlinePill dueDate={incorporationCase.targetCompletionDate} />
              ) : null}
              <span className="text-muted-foreground">{incorporationCase.ownerName}</span>
              <Link
                to="/incorporation/$id"
                params={{ id: incorporationCase.id }}
                className="rounded-md border px-2 py-1 text-xs"
              >
                Open
              </Link>
            </div>
          ))}
          {cases.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No incorporation cases yet.</p>
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
