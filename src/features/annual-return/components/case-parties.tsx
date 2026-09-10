import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCheck, Users } from "lucide-react";

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

export function CaseParties({ caseId, locked }: { caseId: string; locked: boolean }) {
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      // The requirements this party owes were created by the same transaction,
      // so the findings panel beside this one is now stale.
      await queryClient.invalidateQueries({
        queryKey: ["annual-return", "case-findings", caseId],
      });
    },
  });

  const parties = partiesQuery.data ?? [];
  const unconfirmed = parties.filter((party) => party.active && !party.confirmedByUserId);

  return (
    <section className="border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">申報相關人士</h2>
        {partiesQuery.isPending ? null : (
          <span className="text-sm text-muted-foreground">
            {parties.length - unconfirmed.length}/{parties.length} 已確認
          </span>
        )}
      </div>

      {partiesQuery.error ? (
        <p className="mt-3 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          無法載入相關人士名單。在確認之前，個人層面的要求不會出現。
        </p>
      ) : null}

      {/* The requirement set is knowably incomplete while a candidate is
          unconfirmed, and saying so is the point. A short list presented as the
          whole list is exactly the false completeness this model prevents. */}
      {unconfirmed.length > 0 ? (
        <p className="mt-3 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          尚有 {unconfirmed.length}{" "}
          位人士未經確認。在確認之前，他們的身分證明及地址證明要求不會建立，
          因此本案件的要求清單並不完整。
        </p>
      ) : null}

      {partiesQuery.isPending ? (
        <p className="mt-3 text-sm text-muted-foreground">載入中…</p>
      ) : parties.length === 0 ? (
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
                <button
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
                  disabled={locked || confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate({ partyId: party.id })}
                  type="button"
                >
                  <UserCheck aria-hidden className="h-3.5 w-3.5" />
                  確認為相關人士
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmMutation.error ? (
        <p className="mt-3 text-sm text-status-red">無法確認，請再試一次。</p>
      ) : null}
    </section>
  );
}
