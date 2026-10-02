import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createAnnualReturnRepository } from "./repository";
import { createProductionFollowUpRepository } from "./follow-up-repository";
import { deriveProductionFollowUpDrafts } from "./follow-ups";
import { getAnnualReturnActionPermission } from "./permissions";
import { hasOutstandingClientWork } from "./outstanding";
import { hongKongBusinessDate } from "./workflow";
/** Produces a current suggestion only. Never creates a reminder log or outbox row. */
export async function prepareMissingEvidenceDraft(
  db: SqlClient | postgres.TransactionSql,
  actor: AuthenticatedActor,
  caseId: string,
) {
  if (!actor.userId || actor.role === "Client")
    throw new Error("Forbidden: staff identity required.");
  const caseItem = await createAnnualReturnRepository({ sql: db }).getCase(caseId);
  if (
    !caseItem ||
    !getAnnualReturnActionPermission(
      { id: actor.userId, role: actor.role, teamId: actor.teamId, active: actor.active },
      caseItem,
      "record_reminder",
    ).allowed
  )
    throw new Error("Forbidden: current case scope denied.");
  if (!hasOutstandingClientWork(caseItem))
    throw new Error(
      "Locked: no definite outstanding client evidence. Received/unknown evidence is not batch chased.",
    );
  const state = await createProductionFollowUpRepository({ sql: db }).listPersistedState([caseId]);
  const draft = deriveProductionFollowUpDrafts([caseItem], state, hongKongBusinessDate()).find(
    (d) => d.source === "annual-return",
  );
  if (!draft || draft.status !== "draft" || !draft.phone || !draft.recipientName)
    throw new Error(
      "Locked: draft needs a persisted recipient and no existing or unknown dispatch.",
    );
  const templates =
    await db`select template_name,language_code,status,body,updated_at::text from whatsapp_templates where provider='woztell' and template_name='annual_return_manual_reminder' and language_code='en'`;
  return {
    version: JSON.stringify({ version: draft.version, templates }),
    output: { ...draft, kind: "follow_up_draft", status: "draft", approvalRequired: true },
  };
}
