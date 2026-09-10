import type { AnnualReturnChecklistItem } from "./types";

/**
 * Only what these predicates actually read.
 *
 * The client portal projects a deliberately narrower checklist -- no caseId, no
 * receivedAt/verifiedAt, no documentId -- because a client has no business
 * seeing internal review timestamps. Typing against the full row would have
 * forced that projection to widen.
 */
export type ChecklistItemState = Pick<AnnualReturnChecklistItem, "required" | "status">;

/**
 * What is still owed by the client, and what is owed by us.
 *
 * These were the same question everywhere, asked as `status !== "Verified"`, and
 * that is wrong in one specific and client-facing way: a document the client has
 * already sent sits at `Received` until a staff member reviews it, and
 * `Received !== "Verified"`. So the portal told clients "we are still waiting on
 * N documents from you" for documents they had already sent, and the chase draft
 * listed those documents again.
 *
 * The two sets are disjoint by construction:
 *
 * - `Missing` and `Rejected` are the client's move. Rejected genuinely is: the
 *   document came back wrong and a replacement is needed.
 * - `Received` is ours. The evidence is here and unreviewed.
 * - `Verified` is nobody's.
 *
 * `hasRequiredChecklistEvidence` in ./workflow.ts is untouched and must stay
 * untouched. It is the internal filing gate, its four-way conjunction is
 * deliberately redundant with `updateChecklistItem`'s lockstep writes so a
 * drifted row cannot pass, and loosening it would let a case file on evidence
 * nobody checked. This module answers a different question.
 */

export function isOutstandingForClient(item: ChecklistItemState): boolean {
  if (!item.required) return false;
  return item.status === "Missing" || item.status === "Rejected";
}

/** Received and not yet reviewed: our work, never the client's. */
export function isAwaitingInternalReview(item: ChecklistItemState): boolean {
  return item.status === "Received";
}

export function outstandingForClient<T extends ChecklistItemState>(checklist: readonly T[]): T[] {
  return checklist.filter(isOutstandingForClient);
}

export function awaitingInternalReview<T extends ChecklistItemState>(checklist: readonly T[]): T[] {
  return checklist.filter(isAwaitingInternalReview);
}

/**
 * What we can say about a case's outstanding client work.
 *
 * `unknown` is a distinct answer and not a convenience. A case with no checklist
 * rows at all is a data anomaly -- `createCase` expands a template into items, so
 * a real case has them -- and reading that as "nothing outstanding" would trade
 * the bug this module fixes for a quieter one: a case that silently stops being
 * chased before a statutory deadline. We do not know, and the caller is told so.
 */
export type OutstandingSummary =
  | { kind: "outstanding"; items: readonly ChecklistItemState[] }
  | { kind: "none" }
  | { kind: "unknown" };

export function outstandingSummary(case_: {
  checklist?: readonly ChecklistItemState[];
}): OutstandingSummary {
  const checklist = case_.checklist;
  if (!checklist || checklist.length === 0) return { kind: "unknown" };
  const items = outstandingForClient(checklist);
  return items.length > 0 ? { kind: "outstanding", items } : { kind: "none" };
}

/**
 * Whether a chase draft should be produced.
 *
 * `deriveProductionFollowUpDrafts` emitted one for every mutable case
 * unconditionally -- its loop had no outstanding-work test at all -- so a client
 * who had sent everything was still queued for a reminder listing nothing.
 *
 * Only a definite `none` suppresses the draft. An `unknown` case still produces
 * one, because the safer error against a filing deadline is to ask when we did
 * not need to, not to stay silent when we did.
 */
export function shouldChaseClient(case_: { checklist?: readonly ChecklistItemState[] }): boolean {
  return outstandingSummary(case_).kind !== "none";
}

/** True only when something is genuinely outstanding. */
export function hasOutstandingClientWork(case_: {
  checklist?: readonly ChecklistItemState[];
}): boolean {
  return outstandingSummary(case_).kind === "outstanding";
}
