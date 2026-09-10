import { addCalendarMonths } from "@/lib/date-math";

/**
 * The approved annual-return requirement set, and who each requirement is owed
 * by.
 *
 * Phase B built the table that can express "two directors need two identity
 * documents"; this is the rule that says so. Nothing here reads a document or
 * decides whether a requirement is met -- `requirements.ts` does that against
 * evidence. This only produces the instances.
 *
 * Three things are deliberately refused rather than guessed:
 *
 * - An unconfirmed party produces no requirement. `case_parties` says it
 *   plainly: "a requirement must never be judged complete or incomplete against
 *   a guess about who the parties are." A candidate director is not a director.
 * - A missing reference date produces no age window. The schema forbids
 *   defaulting it to today, "which would silently re-age every document each
 *   time it was read".
 * - An unknown document date is `unknown`, never `fresh`. There is no
 *   server-side text extraction (BLOCKED_INTEGRATION: document-text-extraction),
 *   so today that is every document -- and "we could not tell how old this is"
 *   must never render as "recent enough".
 */

/**
 * Bumped when the rule set changes, never edited in place.
 *
 * A decision recorded under the previous rule stays legible as a decision under
 * the previous rule. Note that existing rows carry `'legacy'`, written by
 * migration 0026 from free-text checklist labels -- so a lookup keyed on
 * `requirementKey` alone will not match them, and anything dispatching on a key
 * has to know which template version produced the row.
 */
export const ANNUAL_RETURN_TEMPLATE_VERSION = "annual-return-2026-09";

/** Written by migration 0026's backfill, from free-text checklist item labels. */
export const LEGACY_TEMPLATE_VERSION = "legacy";

export type PartyType =
  | "director"
  | "secretary"
  | "designated_representative"
  | "shareholder"
  | "company"
  | "other";

export type RequirementScope =
  /** Owed by the company. An NAR1 is not owed by a director. */
  | { kind: "company" }
  /** Owed by each party of these types, one instance each. */
  | { kind: "party"; partyTypes: readonly PartyType[] };

export type RequirementDefinition = {
  key: string;
  label: string;
  scope: RequirementScope;
  /**
   * How old the evidence may be, in calendar months, measured from the
   * instance's reference date. Absent where age is irrelevant -- a signed NAR1
   * does not go stale.
   */
  ageLimitMonths?: number;
};

/**
 * The approved set.
 *
 * Keys are stable machine identifiers; labels are what a person reads. The two
 * are separate because migration 0026 taught the cost of conflating them: it
 * backfilled `requirement_key` from free-text labels, so real rows read
 * "Proof of address for each director" and no code keyed on a tidy identifier
 * matches them.
 */
export const ANNUAL_RETURN_REQUIREMENTS: readonly RequirementDefinition[] = [
  { key: "nar1", label: "周年申報表 NAR1", scope: { kind: "company" } },
  { key: "agm", label: "股東周年大會記錄", scope: { kind: "company" } },
  { key: "cdd", label: "客戶盡職審查 (CDD)", scope: { kind: "company" } },
  {
    key: "identity",
    label: "身分證明文件",
    // Secretaries and designated representatives are identified too; a
    // shareholder is not, under this rule set.
    scope: { kind: "party", partyTypes: ["director", "secretary", "designated_representative"] },
  },
  {
    key: "address-proof",
    label: "地址證明",
    scope: { kind: "party", partyTypes: ["director", "secretary", "designated_representative"] },
    ageLimitMonths: 3,
  },
];

export type CaseParty = {
  id: string;
  partyType: PartyType;
  displayName: string;
  /** A party nobody has confirmed is a candidate, not a party. */
  confirmed: boolean;
  active: boolean;
};

export type RequirementInstanceDraft = {
  checklistItemId: string;
  /** Null for a company-level requirement. */
  partyId: string | null;
  requirementKey: string;
  templateVersion: string;
  /** Null unless the requirement has an age rule and a reference date exists. */
  referenceDate: string | null;
};

export type TemplateResult = {
  drafts: RequirementInstanceDraft[];
  /**
   * True when active parties exist that nobody has confirmed, so the requirement
   * set is knowably incomplete. The screen has to say this rather than present a
   * short list as the whole list.
   */
  awaitingPartyConfirmation: boolean;
};

/**
 * Which requirement instances a case should have.
 *
 * `checklistItemIdFor` maps a requirement key onto the checklist row it refines;
 * a key with no checklist row yields no instance, because the checklist item is
 * the case's authority for overall state and an instance without one would be
 * invisible to every existing consumer.
 */
export function buildRequirementInstances(input: {
  parties: readonly CaseParty[];
  checklistItemIdFor: (requirementKey: string) => string | null;
  /** Where an age window is measured from. Null means there is no window. */
  referenceDate: string | null;
  requirements?: readonly RequirementDefinition[];
}): TemplateResult {
  const requirements = input.requirements ?? ANNUAL_RETURN_REQUIREMENTS;
  const usableParties = input.parties.filter((party) => party.active && party.confirmed);
  const drafts: RequirementInstanceDraft[] = [];

  for (const requirement of requirements) {
    const checklistItemId = input.checklistItemIdFor(requirement.key);
    if (!checklistItemId) continue;

    // An age window needs a stated anchor. Without one there is no window --
    // not a window starting today.
    const referenceDate = requirement.ageLimitMonths ? input.referenceDate : null;

    if (requirement.scope.kind === "company") {
      drafts.push({
        checklistItemId,
        partyId: null,
        requirementKey: requirement.key,
        templateVersion: ANNUAL_RETURN_TEMPLATE_VERSION,
        referenceDate,
      });
      continue;
    }

    const partyTypes = requirement.scope.partyTypes;
    for (const party of usableParties) {
      if (!partyTypes.includes(party.partyType)) continue;
      drafts.push({
        checklistItemId,
        partyId: party.id,
        requirementKey: requirement.key,
        templateVersion: ANNUAL_RETURN_TEMPLATE_VERSION,
        referenceDate,
      });
    }
  }

  return {
    drafts,
    awaitingPartyConfirmation: input.parties.some((party) => party.active && !party.confirmed),
  };
}

export type EvidenceFreshness =
  | { kind: "fresh"; notOlderThan: string }
  /** Older than the window. The date is known and it is too old. */
  | { kind: "stale"; notOlderThan: string; documentDate: string }
  /**
   * Could not be determined. Either the document's date is unknown -- which is
   * every document today, since nothing extracts text -- or no reference date
   * has been set. Never rendered as acceptance.
   */
  | { kind: "unknown"; reason: "no-document-date" | "no-reference-date" };

/**
 * Whether age-limited evidence is recent enough.
 *
 * The window is calendar months, not 90 days. The repo's existing "1 month" is a
 * 30-day approximation in `reminder-cadence.ts` and the filing window is +42
 * days; following either here would disagree with the agreed rule in February
 * and across any pair of 31-day months.
 */
export function evidenceFreshness(input: {
  documentDate: string | null;
  referenceDate: string | null;
  ageLimitMonths: number;
}): EvidenceFreshness {
  if (!input.referenceDate) return { kind: "unknown", reason: "no-reference-date" };
  if (!input.documentDate) return { kind: "unknown", reason: "no-document-date" };

  const notOlderThan = addCalendarMonths(input.referenceDate, -input.ageLimitMonths);

  // Inclusive: a document dated exactly the boundary is within "not older than
  // three months". Lexicographic comparison is safe and exact for YYYY-MM-DD.
  return input.documentDate >= notOlderThan
    ? { kind: "fresh", notOlderThan }
    : { kind: "stale", notOlderThan, documentDate: input.documentDate };
}

/** What to tell a reviewer, without implying an answer nobody has. */
export function describeFreshness(freshness: EvidenceFreshness): string {
  switch (freshness.kind) {
    case "fresh":
      return `在有效期內（不早於 ${freshness.notOlderThan}）。`;
    case "stale":
      return `已超過期限：文件日期 ${freshness.documentDate}，需不早於 ${freshness.notOlderThan}。`;
    case "unknown":
      return freshness.reason === "no-document-date"
        ? "無法判斷文件日期，因此未能檢查是否在有效期內。這不代表文件符合要求。"
        : "未設定計算基準日期，因此未能檢查是否在有效期內。這不代表文件符合要求。";
  }
}
