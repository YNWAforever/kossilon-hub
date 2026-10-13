import { parseEntityId } from "@/lib/entity-id";
import { LoadingRows } from "@/components/ui/skeleton";
import { RecordUnavailable } from "@/components/record-unavailable";
import {
  BR_NUMBER_MESSAGE,
  CR_NUMBER_MESSAGE,
  isValidBrNumber,
  isValidCrNumber,
} from "@/features/clients/identifiers";
import { formatDate } from "@/lib/format-date";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
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
import { CHECKLIST_ITEM_STATUS_LABELS, INCORPORATION_STATUS_LABELS } from "../labels";

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

const REGISTRY_NUMBERS_ERROR = "必須填寫 CR 號碼及 BR 號碼。";

export function ProductionIncorporationDetail({ caseId }: { caseId: string }) {
  // A malformed link can never name a case; asking the server only fails its
  // schema validation, which used to read as a temporary outage.
  if (parseEntityId(caseId) === null) return <IncorporationNotFound />;
  return <IncorporationDetail caseId={caseId} />;
}

function IncorporationNotFound() {
  return (
    <RecordUnavailable
      title="找不到公司註冊案件"
      back={<Link to="/incorporation">返回公司註冊</Link>}
    />
  );
}

function IncorporationDetail({ caseId }: { caseId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [completionForm, setCompletionForm] = useState({
    crNumber: "",
    brNumber: "",
    incorporationDate: "",
  });
  const [completionError, setCompletionError] = useState<string | null>(null);
  const registryNumbersInvalid = completionError === REGISTRY_NUMBERS_ERROR;
  const crInvalid = registryNumbersInvalid || completionError === CR_NUMBER_MESSAGE;
  const brInvalid = registryNumbersInvalid || completionError === BR_NUMBER_MESSAGE;

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
    onError: () => toast.error("未能更新案件狀態，請再試一次。"),
  });

  const updateItem = useMutation({
    mutationFn: (input: { itemId: string; status: ChecklistItemStatus; note: string | null }) =>
      updateIncorporationChecklistItem({ data: { caseId, ...input } }),
    onSuccess: invalidate,
    onError: () => toast.error("未能更新清單項目，請再試一次。"),
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
      toast.success("公司註冊已完成，已建立公司紀錄。");
      invalidate();
      if (result.companyId) {
        void navigate({ to: "/clients/$id", params: { id: result.companyId } });
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "未能完成案件。";
      setCompletionError(message);
      toast.error(message);
    },
  });

  if (caseQuery.isPending) {
    return <LoadingRows label="載入案件中" rows={6} className="p-6" />;
  }

  if (caseQuery.isError) {
    return (
      <RecordUnavailable
        title="案件無法載入"
        message="案件資料暫時無法載入，請稍後再試。"
        back={<Link to="/incorporation">返回公司註冊</Link>}
        onRetry={() => void caseQuery.refetch()}
      />
    );
  }

  const incorporationCase = caseQuery.data;

  if (!incorporationCase) return <IncorporationNotFound />;

  const upcoming = nextStatus(incorporationCase.status);

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="案件與客戶"
        title={incorporationCase.proposedCompanyNameEn}
        subtitle={`目標完成日期 ${formatDate(incorporationCase.targetCompletionDate)}`}
      />

      <section className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            狀態
          </p>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill tone={incorporationCase.status === "Completed" ? "green" : "yellow"}>
              {INCORPORATION_STATUS_LABELS[incorporationCase.status]}
            </StatusPill>
            {upcoming ? (
              <Button
                size="sm"
                className="h-auto whitespace-normal py-2"
                onClick={() => advanceStatus.mutate(upcoming)}
                disabled={advanceStatus.isPending}
              >
                推進至「{INCORPORATION_STATUS_LABELS[upcoming]}」
              </Button>
            ) : null}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            負責同事／團隊
          </p>
          <p className="mt-1 text-sm">
            {incorporationCase.ownerName} · {incorporationCase.teamName}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            註冊辦事處
          </p>
          <p className="mt-1 text-sm">{incorporationCase.proposedRegisteredOffice}</p>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">清單</h2>
        <div className="divide-y">
          {incorporationCase.checklist.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0 truncate text-sm">{item.itemLabel}</span>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={statusTone[item.status]}>
                  {CHECKLIST_ITEM_STATUS_LABELS[item.status]}
                </StatusPill>
                <Select
                  size="sm"
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
                  <option value="Missing">{CHECKLIST_ITEM_STATUS_LABELS.Missing}</option>
                  <option value="Received">{CHECKLIST_ITEM_STATUS_LABELS.Received}</option>
                  <option value="Verified">{CHECKLIST_ITEM_STATUS_LABELS.Verified}</option>
                  <option value="Rejected">{CHECKLIST_ITEM_STATUS_LABELS.Rejected}</option>
                </Select>
              </div>
            </div>
          ))}
        </div>
      </section>

      {incorporationCase.status === "Filed with Registrar" ? (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">完成受理</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();

              if (!completionForm.crNumber.trim() || !completionForm.brNumber.trim()) {
                setCompletionError(REGISTRY_NUMBERS_ERROR);
                return;
              }
              if (!isValidCrNumber(completionForm.crNumber)) {
                setCompletionError(CR_NUMBER_MESSAGE);
                return;
              }
              if (!isValidBrNumber(completionForm.brNumber)) {
                setCompletionError(BR_NUMBER_MESSAGE);
                return;
              }

              setCompletionError(null);
              complete.mutate();
            }}
            className="grid grid-cols-1 gap-4 md:grid-cols-3"
          >
            <div>
              <label
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
                htmlFor="complete-cr"
              >
                CR 號碼
              </label>
              <Input
                id="complete-cr"
                aria-invalid={crInvalid}
                aria-describedby={crInvalid ? "complete-error" : undefined}
                size="sm"
                className="w-full"
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
                BR 號碼
              </label>
              <Input
                id="complete-br"
                aria-invalid={brInvalid}
                aria-describedby={brInvalid ? "complete-error" : undefined}
                size="sm"
                className="w-full"
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
                成立日期
              </label>
              <Input
                id="complete-incorporation-date"
                type="date"
                size="sm"
                className="w-full"
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
            {completionError && (
              <p
                id="complete-error"
                role="alert"
                className="text-xs text-destructive md:col-span-3"
              >
                {completionError}
              </p>
            )}
            <div className="md:col-span-3">
              <Button variant="primary" size="sm" type="submit" disabled={complete.isPending}>
                {complete.isPending ? "處理中…" : "完成受理"}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
