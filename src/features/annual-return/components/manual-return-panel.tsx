import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { annualReturnQueryKeys } from "../query-keys";
import type { ReturnRecord } from "../return-service";
import {
  getAnnualReturnReturnIntakes,
  listAnnualReturnSubmissionProofs,
  reconcileAnnualReturnReturn,
  recordAnnualReturnReturnIntake,
} from "../package-server-fns";

function ReviewReturn({ item, caseId }: { item: ReturnRecord; caseId: string }) {
  const queryClient = useQueryClient();
  const [submissionId, setSubmissionId] = useState(
    item.candidateHandoffIds.length === 1 ? item.candidateHandoffIds[0] : "",
  );
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: (decision: "confirm" | "mark-unmatched") =>
      reconcileAnnualReturnReturn({
        data: {
          returnId: item.id,
          submissionId: decision === "confirm" ? submissionId : null,
          expectedRevision: item.revision,
          decision,
          reason: reason.trim(),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...annualReturnQueryKeys.detail(caseId), "return-intakes"],
      });
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.history(caseId) });
      void queryClient.invalidateQueries({
        queryKey: [...annualReturnQueryKeys.detail(caseId), "case-readiness"],
      });
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.workViews() });
    },
  });
  return (
    <li className="rounded-md border p-3 text-sm">
      <p>
        {item.outcome === "accepted" ? "接納" : item.outcome === "rejected" ? "拒件" : "部分接納"} ·
        {item.matchState === "candidate"
          ? "有候選交件"
          : item.matchState === "reconciled"
            ? "已對應交件"
            : "未對應交件"}{" "}
        ·{item.open ? "待核對" : "已核對"}
      </p>
      <p>外部參考編號： {item.externalReference}</p>
      <details>
        <summary>回件技術資料</summary>
        <p>Manifest SHA-256：{item.manifestHash ?? "來源未提供"}</p>
        <p>
          來源：{item.sourceKind} · 版本 {item.revision}
        </p>
      </details>
      {!item.reconciledAt && (
        <div className="mt-2 grid gap-2">
          <label>
            要核對的交件紀錄
            <select
              aria-label={"要核對的交件紀錄：" + item.externalReference}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2"
              value={submissionId}
              onChange={(event) => setSubmissionId(event.target.value)}
            >
              <option value="">選擇候選交件紀錄</option>
              {item.candidateHandoffIds.map((candidateId) => (
                <option key={candidateId} value={candidateId}>
                  {`交件紀錄 …${candidateId.slice(-8)}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            核對原因
            <input
              aria-label={"核對原因：" + item.externalReference}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-2 disabled:opacity-50"
              disabled={mutation.isPending || !submissionId}
              onClick={() => mutation.mutate("confirm")}
            >
              確認對應
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-2 disabled:opacity-50"
              disabled={mutation.isPending || reason.trim().length < 10}
              onClick={() => mutation.mutate("mark-unmatched")}
            >
              標記無法對應
            </button>
          </div>
          {mutation.isError && (
            <p role="alert" className="text-destructive">
              {mutation.error.message}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Manual fallback while the internal return source protocol is unavailable. */
export function ManualReturnPanel({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const returnKey = [...annualReturnQueryKeys.detail(caseId), "return-intakes"];
  const proofsKey = [...annualReturnQueryKeys.detail(caseId), "return-proofs"];
  const returns = useQuery({
    queryKey: returnKey,
    queryFn: () => getAnnualReturnReturnIntakes({ data: { caseId } }),
  });
  const proofs = useQuery({
    queryKey: proofsKey,
    queryFn: () => listAnnualReturnSubmissionProofs({ data: { caseId } }),
  });
  const [externalReference, setExternalReference] = useState("");
  const [manifestHash, setManifestHash] = useState("");
  const [outcome, setOutcome] = useState<"accepted" | "rejected" | "partial">("accepted");
  const [detail, setDetail] = useState("");
  const [proofVersionId, setProofVersionId] = useState("");
  const intake = useMutation({
    mutationFn: () =>
      recordAnnualReturnReturnIntake({
        data: {
          caseId,
          externalReference: externalReference.trim(),
          manifestHash: manifestHash.trim() || null,
          outcome,
          detail: detail.trim() || null,
          source: { kind: "manual", proofVersionId },
        },
      }),
    onSuccess: () => {
      setExternalReference("");
      setManifestHash("");
      setDetail("");
      setProofVersionId("");
      void queryClient.invalidateQueries({ queryKey: returnKey });
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.history(caseId) });
      void queryClient.invalidateQueries({
        queryKey: [...annualReturnQueryKeys.detail(caseId), "case-readiness"],
      });
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.workViews() });
    },
  });
  return (
    <section id="returns" className="scroll-mt-8 border-b pb-4">
      <h2 className="text-base font-semibold">人手登記交件回件</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        請先在文件庫上載真實回執，完成掃描及人手覆核，再由負責同事登記外部回件主張。內部伺服器同步尚未接通；此表格不代表已同步。核對也不會自動標記為已交件。
      </p>
      {returns.isError && (
        <p role="alert" className="text-sm text-destructive">
          {returns.error.message}
        </p>
      )}
      {proofs.isError && (
        <p role="alert" className="text-sm text-destructive">
          {proofs.error.message}
        </p>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          回件外部參考編號
          <input
            aria-label="回件外部參考編號"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            maxLength={200}
            value={externalReference}
            onChange={(event) => setExternalReference(event.target.value)}
          />
        </label>
        <label className="text-sm">
          回件聲稱結果
          <select
            aria-label="回件聲稱結果"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as typeof outcome)}
          >
            <option value="accepted">接納</option>
            <option value="rejected">拒件</option>
            <option value="partial">部分接納</option>
          </select>
        </label>
        <label className="text-sm">
          回件聲稱的 Manifest SHA-256（可選）
          <input
            aria-label="回件 Manifest SHA-256"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            maxLength={64}
            value={manifestHash}
            onChange={(event) => setManifestHash(event.target.value)}
          />
        </label>
        <label className="text-sm">
          已覆核回執
          <select
            aria-label="已覆核回執"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            value={proofVersionId}
            onChange={(event) => setProofVersionId(event.target.value)}
          >
            <option value="">選擇已覆核回執</option>
            {proofs.data
              ?.filter((proof) => proof.category === "receipt")
              .map((proof) => (
                <option key={proof.versionId} value={proof.versionId}>
                  {proof.fileName}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm md:col-span-2">
          外部回件詳情（可選）
          <textarea
            aria-label="回件外部詳情"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            maxLength={2000}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />
        </label>
        <div className="md:col-span-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-2 disabled:opacity-50"
            onClick={() => void proofs.refetch()}
            disabled={proofs.isFetching}
          >
            重新載入已覆核回執
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-2 disabled:opacity-50"
            disabled={intake.isPending || !externalReference.trim() || !proofVersionId}
            onClick={() => intake.mutate()}
          >
            登記回件主張
          </button>
        </div>
      </div>
      {intake.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {intake.error.message}
        </p>
      )}
      <ul className="mt-4 space-y-2">
        {returns.data?.map((item) => (
          <ReviewReturn key={item.id} item={item} caseId={caseId} />
        ))}
      </ul>
      {returns.data && returns.data.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          此案件暫未有人手登記回件。內部來源同步尚未接通，請由負責同事核對外部回執。
        </p>
      )}
    </section>
  );
}
