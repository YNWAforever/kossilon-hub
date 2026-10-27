import { useRef, useState } from "react";
import { LoadingRows } from "@/components/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

import {
  confirmAnnualReturnCaseParty,
  listAnnualReturnCaseParties,
} from "@/features/annual-return/server-fns";

/**
 * Who this filing is for, and whether anybody has said so.
 *
 * Nothing wrote `case_parties` at all, so the per-party requirement model Phase B
 * built was unreachable: no party ever existed, and only company-level
 * requirements could be produced. Candidates are seeded from the company's
 * officer register on read; confirming one creates the requirements that party
 * owes, in the same transaction.
 *
 * A candidate is not a party. The schema says so directly, and the screen has to
 * as well: until somebody confirms, the requirement list for this case is
 * knowably incomplete, and showing it as though it were whole is the false
 * completeness this model exists to prevent.
 */

const PARTY_TYPE_LABELS: Record<string, string> = {
  director: "董事",
  secretary: "公司秘書",
  designated_representative: "指定代表",
  shareholder: "股東",
  company: "公司",
  other: "其他",
};

export function CaseParties(props: { caseId: string; locked: boolean }) {
  return <CasePartiesPanel key={props.caseId} {...props} />;
}

function CasePartiesPanel({ caseId, locked }: { caseId: string; locked: boolean }) {
  const submitting = useRef(false);
  const recovering = useRef(false);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["annual-return", "case-parties", caseId];

  const partiesQuery = useQuery({
    queryKey,
    queryFn: () => listAnnualReturnCaseParties({ data: { caseId } }),
    retry: false,
  });

  const confirmMutation = useMutation({
    mutationFn: (input: { partyId: string }) =>
      confirmAnnualReturnCaseParty({ data: { caseId, partyId: input.partyId } }),
    retry: false,
    onError: () => setNeedsReconciliation(true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      // The requirements this party owes were created by the same transaction,
      // so the findings panel beside this one is now stale.
      await queryClient.invalidateQueries({
        queryKey: ["annual-return", "case-findings", caseId],
      });
      submitting.current = false;
    },
  });

  const current = !needsReconciliation && partiesQuery.isSuccess && !partiesQuery.isFetching;
  // Cached candidates cannot establish current completeness or authority to confirm.
  const parties = current ? (partiesQuery.data ?? []) : [];
  const unconfirmed = parties.filter((party) => party.active && !party.confirmedByUserId);

  return (
    <section className="border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">申報相關人士</h2>
        {!current ? null : (
          <span className="text-sm text-muted-foreground">
            {parties.length - unconfirmed.length}/{parties.length} 已確認
          </span>
        )}
      </div>

      {partiesQuery.error && !needsReconciliation ? (
        <div
          role="alert"
          className="mt-3 space-y-2 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text"
        >
          <p>無法載入相關人士名單。在確認之前，個人層面的要求不會出現。</p>
          <Button
            type="button"
            className="min-h-11"
            disabled={partiesQuery.isFetching}
            onClick={() => void partiesQuery.refetch({ cancelRefetch: false })}
          >
            重新載入相關人士
          </Button>
        </div>
      ) : null}

      {needsReconciliation ? (
        <div role="alert" className="mt-3 space-y-2 text-sm">
          <p>相關人士確認結果未能核實。請先重新核對名單；沒有自動重試確認操作。</p>
          <Button
            type="button"
            className="min-h-11"
            disabled={reconciling}
            onClick={async () => {
              if (recovering.current) return;
              recovering.current = true;
              setReconciling(true);
              try {
                // Independent readback avoids accepting reverted cached data
                // from a cancelled refetch as a fresh confirmation result.
                await queryClient.cancelQueries({ queryKey, exact: true });
                const parties = await listAnnualReturnCaseParties({ data: { caseId } });
                if (!Array.isArray(parties)) throw new Error("Parties unavailable");
                await queryClient.cancelQueries({ queryKey, exact: true });
                queryClient.setQueryData(queryKey, parties);
                // A lost response may follow creation of person-level requirements.
                await queryClient.invalidateQueries({
                  queryKey: ["annual-return", "case-findings", caseId],
                });
                confirmMutation.reset();
                submitting.current = false;
                setNeedsReconciliation(false);
              } catch {
                // Keep every candidate blocked until explicit readback succeeds.
              } finally {
                recovering.current = false;
                setReconciling(false);
              }
            }}
          >
            重新核對確認結果
          </Button>
        </div>
      ) : null}

      {/* The requirement set is knowably incomplete while a candidate is
          unconfirmed, and saying so is the point. A short list presented as the
          whole list is exactly the false completeness this model prevents. */}
      {unconfirmed.length > 0 ? (
        <p className="mt-3 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text">
          尚有 {unconfirmed.length}{" "}
          位人士未經確認。在確認之前，他們的身分證明及地址證明要求不會建立，
          因此本案件的要求清單並不完整。
        </p>
      ) : null}

      {needsReconciliation ? null : partiesQuery.isPending || partiesQuery.isFetching ? (
        <LoadingRows label="正在載入當事人…" rows={2} className="mt-3 p-0" />
      ) : partiesQuery.isError ? null : parties.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          公司董事名冊沒有在任人士，因此沒有可確認的對象。個人層面的要求不會建立。
        </p>
      ) : (
        <div className="mt-3 divide-y border-y">
          {parties.map((party) => (
            <div
              key={party.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Users aria-hidden className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{party.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {PARTY_TYPE_LABELS[party.partyType] ?? party.partyType}
                    {party.officerId ? " · 來自董事名冊" : " · 手動加入"}
                  </p>
                </div>
              </div>

              {party.confirmedByUserId ? (
                <span className="text-xs text-muted-foreground">已確認</span>
              ) : (
                <Button
                  size="sm"
                  disabled={locked || confirmMutation.isPending}
                  onClick={() => {
                    // Pending renders cannot guard multiple clicks in one event turn.
                    if (locked || submitting.current || partiesQuery.isFetching) return;
                    submitting.current = true;
                    confirmMutation.mutate({ partyId: party.id });
                  }}
                >
                  <UserCheck aria-hidden className="h-3.5 w-3.5" />
                  確認為相關人士
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
