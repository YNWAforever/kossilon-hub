import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import {
  completeIncorporationCase,
  getIncorporationCase,
  updateIncorporationCaseStatus,
  updateIncorporationChecklistItem,
} from "../server-fns";
import { INCORPORATION_STATUSES } from "../types";
import type { ChecklistItemStatus, IncorporationStatus } from "../types";

const statusTone: Record<ChecklistItemStatus, StatusTone> = {
  Missing: "neutral",
  Received: "yellow",
  Verified: "green",
  Rejected: "red",
};

function nextStatus(current: IncorporationStatus): IncorporationStatus | null {
  const index = INCORPORATION_STATUSES.indexOf(current);
  return index >= 0 && index < INCORPORATION_STATUSES.length - 1
    ? INCORPORATION_STATUSES[index + 1]
    : null;
}

export function ProductionIncorporationDetail({ caseId }: { caseId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [completionForm, setCompletionForm] = useState({
    crNumber: "",
    brNumber: "",
    incorporationDate: "",
  });

  const caseQuery = useQuery({
    queryKey: ["incorporation-cases", caseId],
    queryFn: () => getIncorporationCase({ data: { id: caseId } }),
    retry: false,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["incorporation-cases", caseId] });
    void queryClient.invalidateQueries({ queryKey: ["incorporation-cases"] });
  }

  const advanceStatus = useMutation({
    mutationFn: (status: IncorporationStatus) =>
      updateIncorporationCaseStatus({ data: { caseId, status } }),
    onSuccess: invalidate,
    onError: () => toast.error("Unable to update the case status. Try again."),
  });

  const updateItem = useMutation({
    mutationFn: (input: { itemId: string; status: ChecklistItemStatus; note: string | null }) =>
      updateIncorporationChecklistItem({ data: { caseId, ...input } }),
    onSuccess: invalidate,
    onError: () => toast.error("Unable to update the checklist item. Try again."),
  });

  const complete = useMutation({
    mutationFn: () =>
      completeIncorporationCase({
        data: {
          caseId,
          crNumber: completionForm.crNumber,
          brNumber: completionForm.brNumber,
          incorporationDate: completionForm.incorporationDate,
        },
      }),
    onSuccess: (result) => {
      toast.success("Incorporation complete — company created.");
      invalidate();
      if (result.companyId) {
        void navigate({ to: "/clients/$id", params: { id: result.companyId } });
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Unable to complete the case."),
  });

  if (caseQuery.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
        Loading case
      </div>
    );
  }

  const incorporationCase = caseQuery.data;

  if (caseQuery.isError || !incorporationCase) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Incorporation" title="Case unavailable" />
        <p role="alert" className="text-sm text-destructive">
          Case data is unavailable. Try again shortly.
        </p>
      </main>
    );
  }

  const upcoming = nextStatus(incorporationCase.status);

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Incorporation"
        title={incorporationCase.proposedCompanyNameEn}
        subtitle={`Target completion ${incorporationCase.targetCompletionDate}`}
      />

      <section className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Status
          </p>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill tone={incorporationCase.status === "Completed" ? "green" : "yellow"}>
              {incorporationCase.status}
            </StatusPill>
            {upcoming ? (
              <button
                type="button"
                onClick={() => advanceStatus.mutate(upcoming)}
                disabled={advanceStatus.isPending}
                className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
              >
                Advance to {upcoming}
              </button>
            ) : null}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Owner / team
          </p>
          <p className="mt-1 text-sm">
            {incorporationCase.ownerName} · {incorporationCase.teamName}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Registered office
          </p>
          <p className="mt-1 text-sm">{incorporationCase.proposedRegisteredOffice}</p>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Checklist</h2>
        <div className="divide-y">
          {incorporationCase.checklist.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0 truncate text-sm">{item.itemLabel}</span>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={statusTone[item.status]}>{item.status}</StatusPill>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  value={item.status}
                  onChange={(event) =>
                    updateItem.mutate({
                      itemId: item.id,
                      status: event.target.value as ChecklistItemStatus,
                      note: item.note,
                    })
                  }
                  disabled={updateItem.isPending}
                >
                  <option value="Missing">Missing</option>
                  <option value="Received">Received</option>
                  <option value="Verified">Verified</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </section>

      {incorporationCase.status === "Filed with Registrar" ? (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Complete intake</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              complete.mutate();
            }}
            className="grid grid-cols-1 gap-4 md:grid-cols-3"
          >
            <div>
              <label
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
                htmlFor="complete-cr"
              >
                CR number
              </label>
              <input
                id="complete-cr"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
                value={completionForm.crNumber}
                onChange={(event) =>
                  setCompletionForm((current) => ({ ...current, crNumber: event.target.value }))
                }
                required
              />
            </div>
            <div>
              <label
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
                htmlFor="complete-br"
              >
                BR number
              </label>
              <input
                id="complete-br"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
                value={completionForm.brNumber}
                onChange={(event) =>
                  setCompletionForm((current) => ({ ...current, brNumber: event.target.value }))
                }
                required
              />
            </div>
            <div>
              <label
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
                htmlFor="complete-incorporation-date"
              >
                Incorporation date
              </label>
              <input
                id="complete-incorporation-date"
                type="date"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
                value={completionForm.incorporationDate}
                onChange={(event) =>
                  setCompletionForm((current) => ({
                    ...current,
                    incorporationDate: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={complete.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {complete.isPending ? "Completing…" : "Complete intake"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
