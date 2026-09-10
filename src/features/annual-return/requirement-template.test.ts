import { describe, expect, it } from "vitest";
import {
  ANNUAL_RETURN_REQUIREMENTS,
  ANNUAL_RETURN_TEMPLATE_VERSION,
  buildRequirementInstances,
  checklistLookupFor,
  describeFreshness,
  evidenceFreshness,
  matchRequirementKey,
  type CaseParty,
  type PartyType,
} from "./requirement-template";

function party(overrides: Partial<CaseParty> & { id: string }): CaseParty {
  return {
    partyType: "director",
    displayName: "陳大文",
    confirmed: true,
    active: true,
    ...overrides,
  };
}

/** Every requirement key maps to a checklist row, unless a test says otherwise. */
function everyKey(requirementKey: string): string {
  return `item-${requirementKey}`;
}

function build(input: {
  parties?: CaseParty[];
  referenceDate?: string | null;
  checklistItemIdFor?: (key: string) => string | null;
}) {
  return buildRequirementInstances({
    parties: input.parties ?? [],
    checklistItemIdFor: input.checklistItemIdFor ?? everyKey,
    referenceDate: input.referenceDate === undefined ? "2026-06-30" : input.referenceDate,
  });
}

describe("buildRequirementInstances", () => {
  it("owes company requirements to the company, not to a person", () => {
    const { drafts } = build({ parties: [party({ id: "p1" })] });
    for (const key of ["nar1", "agm", "cdd"]) {
      const company = drafts.filter((draft) => draft.requirementKey === key);
      expect(company).toHaveLength(1);
      expect(company[0].partyId).toBeNull();
    }
  });

  // The scenario Phase B's model was built for, now actually produced.
  it("makes one identity requirement per confirmed director", () => {
    const { drafts } = build({
      parties: [
        party({ id: "p1", displayName: "陳大文" }),
        party({ id: "p2", displayName: "李小明" }),
      ],
    });
    const identity = drafts.filter((draft) => draft.requirementKey === "identity");
    expect(identity.map((draft) => draft.partyId).sort()).toEqual(["p1", "p2"]);
  });

  /**
   * `case_parties` states it directly: "a requirement must never be judged
   * complete or incomplete against a guess about who the parties are." A
   * candidate director is not a director.
   */
  it("produces nothing for a party nobody has confirmed", () => {
    const { drafts, awaitingPartyConfirmation } = build({
      parties: [party({ id: "p1" }), party({ id: "p2", confirmed: false })],
    });
    expect(drafts.filter((draft) => draft.partyId === "p2")).toHaveLength(0);
    // And says the set is knowably incomplete, rather than presenting a short
    // list as the whole list.
    expect(awaitingPartyConfirmation).toBe(true);
  });

  it("does not claim the set is incomplete when every party is confirmed", () => {
    expect(build({ parties: [party({ id: "p1" })] }).awaitingPartyConfirmation).toBe(false);
  });

  it("ignores an inactive party, confirmed or not", () => {
    const { drafts, awaitingPartyConfirmation } = build({
      parties: [party({ id: "p1", active: false, confirmed: false })],
    });
    expect(drafts.filter((draft) => draft.partyId !== null)).toHaveLength(0);
    expect(awaitingPartyConfirmation).toBe(false);
  });

  it("applies identity to officers but not to a shareholder", () => {
    const types: PartyType[] = [
      "director",
      "secretary",
      "designated_representative",
      "shareholder",
    ];
    const { drafts } = build({
      parties: types.map((partyType, index) => party({ id: `p${index}`, partyType })),
    });
    const identity = drafts.filter((draft) => draft.requirementKey === "identity");
    expect(identity).toHaveLength(3);
    expect(identity.map((draft) => draft.partyId)).not.toContain("p3");
  });

  it("stamps the template version on every draft", () => {
    const { drafts } = build({ parties: [party({ id: "p1" })] });
    expect(drafts.every((draft) => draft.templateVersion === ANNUAL_RETURN_TEMPLATE_VERSION)).toBe(
      true,
    );
    // Not the value migration 0026 backfilled, which marks rows keyed on
    // free-text labels rather than on these identifiers.
    expect(ANNUAL_RETURN_TEMPLATE_VERSION).not.toBe("legacy");
  });

  it("sets a reference date only where there is an age rule", () => {
    const { drafts } = build({ parties: [party({ id: "p1" })], referenceDate: "2026-06-30" });
    const address = drafts.find((draft) => draft.requirementKey === "address-proof");
    const identity = drafts.find((draft) => draft.requirementKey === "identity");
    expect(address?.referenceDate).toBe("2026-06-30");
    expect(identity?.referenceDate).toBeNull();
  });

  /**
   * The schema forbids defaulting this to today, "which would silently re-age
   * every document each time it was read". No anchor means no window.
   */
  it("leaves the reference date null rather than assuming today", () => {
    const { drafts } = build({ parties: [party({ id: "p1" })], referenceDate: null });
    const address = drafts.find((draft) => draft.requirementKey === "address-proof");
    expect(address).toBeDefined();
    expect(address?.referenceDate).toBeNull();
  });

  // The checklist item is the case's authority for overall state, so an instance
  // without one would be invisible to every existing consumer.
  it("produces no instance for a requirement with no checklist row", () => {
    const { drafts } = build({
      parties: [party({ id: "p1" })],
      checklistItemIdFor: (key) => (key === "cdd" ? null : `item-${key}`),
    });
    expect(drafts.some((draft) => draft.requirementKey === "cdd")).toBe(false);
    expect(drafts.some((draft) => draft.requirementKey === "nar1")).toBe(true);
  });

  it("covers the requirements the plan names", () => {
    expect(ANNUAL_RETURN_REQUIREMENTS.map((requirement) => requirement.key).sort()).toEqual([
      "address-proof",
      "agm",
      "cdd",
      "identity",
      "nar1",
    ]);
  });
});

describe("evidenceFreshness", () => {
  const ageLimitMonths = 3;

  it("accepts evidence inside the window", () => {
    expect(
      evidenceFreshness({
        documentDate: "2026-05-01",
        referenceDate: "2026-06-30",
        ageLimitMonths,
      }),
    ).toMatchObject({ kind: "fresh", notOlderThan: "2026-03-30" });
  });

  it("rejects evidence older than the window", () => {
    expect(
      evidenceFreshness({
        documentDate: "2026-03-29",
        referenceDate: "2026-06-30",
        ageLimitMonths,
      }),
    ).toMatchObject({ kind: "stale", notOlderThan: "2026-03-30" });
  });

  it("accepts evidence dated exactly on the boundary", () => {
    expect(
      evidenceFreshness({
        documentDate: "2026-03-30",
        referenceDate: "2026-06-30",
        ageLimitMonths,
      }),
    ).toMatchObject({ kind: "fresh" });
  });

  // Calendar months, not 90 days. The repo's existing "1 month" is 30 days and
  // the filing window is +42; either would disagree with the agreed rule here.
  it("is not ninety days", () => {
    // 2026-05-31 minus 90 days is 2026-03-02; minus three calendar months,
    // clamped, is 2026-02-28. A document dated 2026-03-01 is fresh under the
    // calendar rule and stale under the day count.
    expect(
      evidenceFreshness({
        documentDate: "2026-03-01",
        referenceDate: "2026-05-31",
        ageLimitMonths,
      }),
    ).toMatchObject({ kind: "fresh", notOlderThan: "2026-02-28" });
  });

  /**
   * The state of every document today. Nothing extracts a document's own date
   * (BLOCKED_INTEGRATION: document-text-extraction), so this branch is not a
   * corner case -- it is the normal one, and it must never read as acceptance.
   */
  it("cannot tell without a document date, and does not guess", () => {
    const freshness = evidenceFreshness({
      documentDate: null,
      referenceDate: "2026-06-30",
      ageLimitMonths,
    });
    expect(freshness).toEqual({ kind: "unknown", reason: "no-document-date" });
    expect(describeFreshness(freshness)).toContain("這不代表文件符合要求");
  });

  it("cannot tell without a reference date either", () => {
    const freshness = evidenceFreshness({
      documentDate: "2026-05-01",
      referenceDate: null,
      ageLimitMonths,
    });
    expect(freshness).toEqual({ kind: "unknown", reason: "no-reference-date" });
    expect(describeFreshness(freshness)).toContain("這不代表文件符合要求");
  });

  it("says how old the document was allowed to be when it refuses one", () => {
    const freshness = evidenceFreshness({
      documentDate: "2026-01-01",
      referenceDate: "2026-06-30",
      ageLimitMonths,
    });
    expect(describeFreshness(freshness)).toContain("2026-03-30");
    expect(describeFreshness(freshness)).toContain("2026-01-01");
  });
});

describe("matchRequirementKey", () => {
  it("matches the labels a person actually types, in both languages", () => {
    expect(matchRequirementKey("Signed NAR1 form")).toBe("nar1");
    expect(matchRequirementKey("周年申報表 NAR1")).toBe("nar1");
    expect(matchRequirementKey("AGM minutes")).toBe("agm");
    expect(matchRequirementKey("股東周年大會記錄")).toBe("agm");
    expect(matchRequirementKey("CDD pack")).toBe("cdd");
    expect(matchRequirementKey("身分證明文件")).toBe("identity");
    expect(matchRequirementKey("Proof of address for each director")).toBe("address-proof");
    expect(matchRequirementKey("地址證明")).toBe("address-proof");
  });

  /**
   * The whole point of being conservative. An instance attached to the wrong
   * checklist row would file one requirement's evidence under another's name,
   * which is worse than having no instance at all.
   */
  it("returns null rather than guessing at a label it does not recognise", () => {
    expect(matchRequirementKey("Miscellaneous supporting papers")).toBeNull();
    expect(matchRequirementKey("")).toBeNull();
    expect(matchRequirementKey("Board resolution")).toBeNull();
  });

  it("returns null when a label could be two requirements at once", () => {
    // Mentions both an identity document and an address proof; which row it is
    // meant to be is not this table's to decide.
    expect(matchRequirementKey("HKID and proof of address")).toBeNull();
  });
});

describe("checklistLookupFor", () => {
  it("maps each requirement onto the checklist row that refines it", () => {
    const lookup = checklistLookupFor([
      { id: "item-nar1", itemLabel: "Signed NAR1 form" },
      { id: "item-id", itemLabel: "身分證明文件" },
    ]);
    expect(lookup.checklistItemIdFor("nar1")).toBe("item-nar1");
    expect(lookup.checklistItemIdFor("identity")).toBe("item-id");
    expect(lookup.checklistItemIdFor("cdd")).toBeNull();
  });

  // Not an error -- the list a person has to look at. Those requirements have no
  // checklist row, so nothing tracks them until somebody adds or renames one.
  it("reports the requirements it could not place", () => {
    const lookup = checklistLookupFor([{ id: "item-nar1", itemLabel: "Signed NAR1 form" }]);
    expect(lookup.unmatched.sort()).toEqual(["address-proof", "agm", "cdd", "identity"]);
  });

  // A second row matching the same key is a duplicate checklist entry, not a
  // second requirement; an instance against each would double every count.
  it("takes the first row when two labels match the same requirement", () => {
    const lookup = checklistLookupFor([
      { id: "item-a", itemLabel: "NAR1 draft" },
      { id: "item-b", itemLabel: "NAR1 signed" },
    ]);
    expect(lookup.checklistItemIdFor("nar1")).toBe("item-a");
  });
});
