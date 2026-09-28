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
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.workViews() });
    },
  });
  return (
    <li className="rounded-md border p-3 text-sm">
      <p>
        {item.outcome} claim · {item.matchState} · {item.open ? "Needs attention" : "Reconciled"}
      </p>
      <p>External reference: {item.externalReference}</p>
      <p>Manifest hash: {item.manifestHash ?? "Not supplied by source"}</p>
      <p>
        Source: {item.sourceKind} · version {item.revision}
      </p>
      {!item.reconciledAt && (
        <div className="mt-2 grid gap-2">
          <label>
            Submission to compare
            <select
              aria-label={"Submission to compare for return " + item.id}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2"
              value={submissionId}
              onChange={(event) => setSubmissionId(event.target.value)}
            >
              <option value="">Choose a candidate submission</option>
              {item.candidateHandoffIds.map((candidateId) => (
                <option key={candidateId} value={candidateId}>
                  {candidateId}
                </option>
              ))}
            </select>
          </label>
          <label>
            Review reason
            <input
              aria-label={"Review reason for return " + item.id}
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
              Confirm match
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-2 disabled:opacity-50"
              disabled={mutation.isPending || reason.trim().length < 10}
              onClick={() => mutation.mutate("mark-unmatched")}
            >
              Mark unmatched
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
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.workViews() });
    },
  });
  return (
    <section className="border-b pb-4">
      <h2 className="text-base font-semibold">Manual filing return intake</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a receipt through Documents, obtain a genuine scan and human review, then record the
        external claim here. The internal server connection is unavailable; this form does not claim
        that it synced. Reconciliation never marks the case Filed.
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
          Return external reference
          <input
            aria-label="Return external reference"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            maxLength={200}
            value={externalReference}
            onChange={(event) => setExternalReference(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Claimed outcome
          <select
            aria-label="Return claimed outcome"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as typeof outcome)}
          >
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="partial">Partial</option>
          </select>
        </label>
        <label className="text-sm">
          Manifest hash quoted by return (optional)
          <input
            aria-label="Return manifest hash"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            maxLength={64}
            value={manifestHash}
            onChange={(event) => setManifestHash(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Reviewed return receipt
          <select
            aria-label="Reviewed return receipt"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            value={proofVersionId}
            onChange={(event) => setProofVersionId(event.target.value)}
          >
            <option value="">Select reviewed receipt</option>
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
          External detail (optional)
          <textarea
            aria-label="Return external detail"
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
            Refresh reviewed receipts
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-2 disabled:opacity-50"
            disabled={intake.isPending || !externalReference.trim() || !proofVersionId}
            onClick={() => intake.mutate()}
          >
            Record return claim
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
          No manual returns recorded for this case. Internal source sync is still blocked.
        </p>
      )}
    </section>
  );
}
