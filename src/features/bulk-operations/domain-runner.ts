import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentStorage } from "@/features/documents/types";
import type { SqlClient } from "@/server/db/client";
import { applyPaymentItem } from "./payment-handler";
import { applyPackageItem, applyReturnItem, applySubmissionItem } from "./package-handler";
import { domainResourceId, type DomainBatchInput } from "./domain-preview";
import type { DomainItemResult } from "./domain-types";

type Db = SqlClient | postgres.TransactionSql;

/** Only existing actor-scoped single-item services can be dispatched here. */
export async function applyDomainItemForActor(
  actor: AuthenticatedActor,
  input: DomainBatchInput,
  resourceId: string,
  dependencies: { sql: Db; storage?: DocumentStorage },
): Promise<DomainItemResult> {
  const item = input.parameters.items.find(
    (candidate) => domainResourceId(input.action, candidate) === resourceId,
  );
  if (!item) throw new Error("Domain batch item is missing from the approved preview.");
  switch (input.action) {
    case "reconcilePayments":
      return applyPaymentItem(actor, item as (typeof input.parameters.items)[number], {
        sql: dependencies.sql,
      });
    case "preparePackages":
      return applyPackageItem(
        actor,
        item as { caseId: string; expectedRevision: number },
        dependencies,
      );
    case "recordSubmissions": {
      const { caseId: _caseId, ...submission } = item as Extract<
        DomainBatchInput,
        { action: "recordSubmissions" }
      >["parameters"]["items"][number];
      return applySubmissionItem(actor, submission, dependencies);
    }
    case "matchReturns":
      return applyReturnItem(
        actor,
        item as Extract<
          DomainBatchInput,
          { action: "matchReturns" }
        >["parameters"]["items"][number],
        dependencies,
      );
  }
}
