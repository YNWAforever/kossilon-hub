# Filing Packet Builder And WhatsApp Follow-Up Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mocked annual-return filing packet workflow with blocker-driven WhatsApp follow-up drafts, mock Send now actions, packet submission, receipt acceptance, and timeline audit events.

**Architecture:** Extend the existing annual return store as the single source of truth. Keep packet readiness, packet status, follow-up draft generation, send eligibility, submission guardrails, and receipt completion as pure helpers or narrow store mutations. UI routes consume those helpers so `/annual-returns`, `/annual-returns/$id`, and `/whatsapp/automation` stay connected without duplicating workflow logic.

**Tech Stack:** React 19, TanStack Router/Start, TypeScript, Tailwind CSS v4 utility classes, Vitest, existing `useSyncExternalStore` annual-return store pattern.

## Global Constraints

- The implementation remains local-state only.
- No real Companies Registry submission.
- No real WhatsApp API call.
- No real file upload or generated PDF packet.
- No new auth, permissions, billing, or backend persistence.
- No broad redesign of unrelated sections.
- No separate client portal in this phase.
- Filed cases are terminal and packet/follow-up controls become read-only.
- Mock Send now must append to the linked case timeline.
- Packet submission must be blocked until the case is ready to file and all packet requirements are complete.
- Receipt acceptance must be blocked until after submission.

---

## File Structure

- Modify `src/lib/annual-return-store.ts`: add packet/follow-up types, seed packet state, derived helpers, send/submission/receipt mutations, and test-safe state access.
- Modify `src/lib/annual-return-store.test.ts`: add helper and mutation coverage for packet readiness, status, blockers, follow-ups, send eligibility, submission, receipt, and filed guards.
- Modify `src/routes/annual-returns.tsx`: add packet status/readiness, follow-up count, and filters for packet-ready and needs-follow-up cases.
- Modify `src/routes/annual-returns.$id.tsx`: add Filing Packet and Follow-Ups panels, submission warnings, Send now action, and receipt acceptance.
- Modify `src/routes/whatsapp.automation.tsx`: replace the current static message with a cross-case annual-return follow-up queue using the same store mutation.

---

### Task 1: Annual Return Packet Domain And Tests

**Files:**
- Modify: `src/lib/annual-return-store.ts`
- Modify: `src/lib/annual-return-store.test.ts`

**Interfaces:**
- Consumes:
  - Existing `AnnualReturnCase`
  - Existing `getBlockers(caseItem: AnnualReturnCase): AnnualReturnBlocker[]`
  - Existing `getReadinessScore(caseItem: AnnualReturnCase): number`
  - Existing `markFiled(caseId: string): { ok: false; reason: string } | { ok: true }`
  - Existing `replaceCase`, `appendTimeline`, `withDerivedStatus`, and test helpers in `annual-return-store.ts`
- Produces:
  - `type AnnualReturnPacketStatus = "not-started" | "building" | "ready-for-review" | "approved" | "submitted" | "accepted"`
  - `type AnnualReturnPacketRequirement`
  - `type AnnualReturnSubmission`
  - `type AnnualReturnReceipt`
  - `type AnnualReturnFollowUpType = "missing-document" | "payment-reminder" | "signature-nudge" | "review-escalation" | "packet-reminder"`
  - `type AnnualReturnFollowUpStatus = "draft" | "sent" | "blocked"`
  - `type AnnualReturnFollowUpDraft`
  - `getPacketReadiness(caseItem: AnnualReturnCase): number`
  - `getPacketStatus(caseItem: AnnualReturnCase): AnnualReturnPacketStatus`
  - `getPacketBlockers(caseItem: AnnualReturnCase): string[]`
  - `getFollowUpDrafts(caseItem: AnnualReturnCase): AnnualReturnFollowUpDraft[]`
  - `canSendFollowUp(caseItem: AnnualReturnCase, draft: AnnualReturnFollowUpDraft): { ok: true } | { ok: false; reason: string }`
  - `togglePacketRequirement(caseId: string, requirementId: string): void`
  - `sendFollowUpNow(caseId: string, draftId: string): { ok: true } | { ok: false; reason: string }`
  - `submitFilingPacket(caseId: string): { ok: true; reference: string } | { ok: false; reason: string }`
  - `acceptFilingReceipt(caseId: string): { ok: true; receiptNumber: string } | { ok: false; reason: string }`

- [ ] **Step 1: Add failing packet helper tests**

Append these imports to the existing import block in `src/lib/annual-return-store.test.ts`:

```ts
  acceptFilingReceipt,
  canSendFollowUp,
  getFollowUpDrafts,
  getPacketBlockers,
  getPacketReadiness,
  getPacketStatus,
  sendFollowUpNow,
  submitFilingPacket,
  togglePacketRequirement,
```

In the existing `baseCase` fixture in `src/lib/annual-return-store.test.ts`, add these fields after `reviewStatus: "not-started"`:

```ts
  packetRequirements: [
    { id: "nar1-draft", label: "NAR1 draft prepared", complete: false, required: true },
    {
      id: "company-particulars",
      label: "Company particulars checked",
      complete: false,
      required: true,
    },
    {
      id: "scr-confirmed",
      label: "Significant controller register confirmed",
      complete: false,
      required: true,
    },
    { id: "signed-nar1-attached", label: "Signed NAR1 attached", complete: false, required: true },
    { id: "payment-proof-checked", label: "Payment proof checked", complete: false, required: true },
    {
      id: "internal-filing-review",
      label: "Internal filing review approved",
      complete: false,
      required: true,
    },
  ],
  sentFollowUpIds: [],
```

Append this test block after the existing `annual return derived helpers` describe block:

```ts
describe("annual return filing packet helpers", () => {
  it("calculates packet readiness from packet requirements", () => {
    expect(getPacketReadiness(baseCase)).toBe(0);
    expect(getPacketBlockers(baseCase)).toEqual([
      "NAR1 draft prepared",
      "Company particulars checked",
      "Significant controller register confirmed",
      "Signed NAR1 attached",
      "Payment proof checked",
      "Internal filing review approved",
    ]);
  });

  it("derives packet status from packet requirements and filing state", () => {
    expect(getPacketStatus(baseCase)).toBe("not-started");
    expect(
      getPacketStatus({
        ...baseCase,
        packetRequirements: [
          { id: "nar1-draft", label: "NAR1 draft prepared", complete: true, required: true },
          {
            id: "company-particulars",
            label: "Company particulars checked",
            complete: false,
            required: true,
          },
        ],
      }),
    ).toBe("building");
  });

  it("generates follow-up drafts from case and packet blockers", () => {
    const drafts = getFollowUpDrafts(baseCase);

    expect(drafts.map((draft) => draft.type)).toContain("missing-document");
    expect(drafts.map((draft) => draft.type)).toContain("payment-reminder");
    expect(drafts.map((draft) => draft.type)).toContain("signature-nudge");
    expect(drafts.map((draft) => draft.type)).toContain("review-escalation");
    expect(drafts.map((draft) => draft.type)).toContain("packet-reminder");
    expect(drafts[0]).toMatchObject({
      caseId: "ar-test",
      companyName: "Test Company Limited",
      recipientName: "Ada Staff",
      phone: "+852 6000 0000",
      status: "draft",
    });
  });

  it("blocks follow-up sends for filed cases", () => {
    const filedCase: AnnualReturnCase = {
      ...baseCase,
      status: "filed",
      sentFollowUpIds: [],
    };
    const [draft] = getFollowUpDrafts(filedCase);

    expect(canSendFollowUp(filedCase, draft)).toEqual({
      ok: false,
      reason: "Filed cases cannot send follow-ups",
    });
  });
});
```

- [ ] **Step 2: Add failing packet mutation tests**

Append this test block inside the existing `annual return store mutations` describe block:

```ts
  it("toggles packet requirements, updates readiness, and appends timeline events", () => {
    togglePacketRequirement("ar-delta", "nar1-draft");

    const caseItem = getAnnualReturnCaseById("ar-delta");

    expect(caseItem?.packetRequirements.find((item) => item.id === "nar1-draft")?.complete).toBe(
      true,
    );
    expect(caseItem && getPacketReadiness(caseItem)).toBeGreaterThan(0);
    expect(caseItem?.timeline[0]).toMatchObject({
      label: "Packet requirement updated",
      detail: "NAR1 draft prepared marked complete.",
    });
  });

  it("mock-sends a follow-up and appends a timeline event", () => {
    const before = getAnnualReturnCaseById("ar-delta");
    const draft = before ? getFollowUpDrafts(before)[0] : undefined;

    expect(draft).toBeDefined();
    expect(draft && sendFollowUpNow("ar-delta", draft.id)).toEqual({ ok: true });

    const after = getAnnualReturnCaseById("ar-delta");

    expect(after?.sentFollowUpIds).toContain(draft?.id);
    expect(after?.timeline[0]?.label).toBe("WhatsApp reminder sent");
  });

  it("refuses to send the same follow-up twice", () => {
    const before = getAnnualReturnCaseById("ar-delta");
    const draft = before ? getFollowUpDrafts(before)[0] : undefined;

    expect(draft).toBeDefined();
    expect(draft && sendFollowUpNow("ar-delta", draft.id)).toEqual({ ok: true });
    expect(draft && sendFollowUpNow("ar-delta", draft.id)).toEqual({
      ok: false,
      reason: "Follow-up has already been sent",
    });
  });

  it("blocks packet submission until case and packet are complete", () => {
    expect(submitFilingPacket("ar-delta")).toEqual({
      ok: false,
      reason:
        "Packet is not ready: case readiness is below 100%; NAR1 draft prepared; Company particulars checked; Significant controller register confirmed; Signed NAR1 attached; Payment proof checked; Internal filing review approved",
    });
  });

  it("submits a complete packet, accepts the receipt, and marks the case filed", () => {
    markDocumentReceived("ar-delta", "signed-nar1");
    markDocumentReceived("ar-delta", "scr");
    updatePaymentStatus("ar-delta", "paid");
    updateSignatureStatus("ar-delta", "received");
    completeChecklistItem("ar-delta", "collect-signed-nar1");
    completeChecklistItem("ar-delta", "verify-scr");
    completeChecklistItem("ar-delta", "confirm-payment");
    completeChecklistItem("ar-delta", "submit-registry");
    updateReviewStatus("ar-delta", "approved");

    for (const requirementId of [
      "nar1-draft",
      "company-particulars",
      "scr-confirmed",
      "signed-nar1-attached",
      "payment-proof-checked",
      "internal-filing-review",
    ]) {
      togglePacketRequirement("ar-delta", requirementId);
    }

    const submitted = submitFilingPacket("ar-delta");
    expect(submitted.ok).toBe(true);

    const submittedCase = getAnnualReturnCaseById("ar-delta");
    expect(submittedCase && getPacketStatus(submittedCase)).toBe("submitted");

    const accepted = acceptFilingReceipt("ar-delta");
    expect(accepted.ok).toBe(true);

    const filedCase = getAnnualReturnCaseById("ar-delta");
    expect(filedCase?.status).toBe("filed");
    expect(filedCase && getPacketStatus(filedCase)).toBe("accepted");
    expect(filedCase?.timeline[0]).toMatchObject({
      label: "Filing receipt accepted",
    });
  });

  it("ignores packet and follow-up mutations after a case is filed", () => {
    markDocumentReceived("ar-delta", "signed-nar1");
    markDocumentReceived("ar-delta", "scr");
    updatePaymentStatus("ar-delta", "paid");
    updateSignatureStatus("ar-delta", "received");
    completeChecklistItem("ar-delta", "collect-signed-nar1");
    completeChecklistItem("ar-delta", "verify-scr");
    completeChecklistItem("ar-delta", "confirm-payment");
    completeChecklistItem("ar-delta", "submit-registry");
    updateReviewStatus("ar-delta", "approved");
    markFiled("ar-delta");

    const before = getAnnualReturnCaseById("ar-delta");
    const timelineLength = before?.timeline.length;

    togglePacketRequirement("ar-delta", "nar1-draft");
    const draft = before ? getFollowUpDrafts(before)[0] : undefined;
    const sendResult = draft ? sendFollowUpNow("ar-delta", draft.id) : undefined;
    const submitResult = submitFilingPacket("ar-delta");

    const after = getAnnualReturnCaseById("ar-delta");

    expect(sendResult).toEqual({
      ok: false,
      reason: "Filed cases cannot send follow-ups",
    });
    expect(submitResult).toEqual({
      ok: false,
      reason: "Filed cases cannot be submitted",
    });
    expect(after?.timeline.length).toBe(timelineLength);
  });
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/lib/annual-return-store.test.ts
```

Expected: FAIL because packet/follow-up exports and fields do not exist.

- [ ] **Step 4: Add packet and follow-up types**

In `src/lib/annual-return-store.ts`, add these types after `AnnualReturnReviewStatus`:

```ts
export type AnnualReturnPacketStatus =
  | "not-started"
  | "building"
  | "ready-for-review"
  | "approved"
  | "submitted"
  | "accepted";

export type AnnualReturnPacketRequirement = {
  id: string;
  label: string;
  complete: boolean;
  required: boolean;
};

export type AnnualReturnSubmission = {
  reference: string;
  submittedAt: string;
  submittedBy: string;
};

export type AnnualReturnReceipt = {
  receiptNumber: string;
  acceptedAt: string;
  acceptedBy: string;
};

export type AnnualReturnFollowUpType =
  | "missing-document"
  | "payment-reminder"
  | "signature-nudge"
  | "review-escalation"
  | "packet-reminder";

export type AnnualReturnFollowUpStatus = "draft" | "sent" | "blocked";

export type AnnualReturnFollowUpDraft = {
  id: string;
  caseId: string;
  companyName: string;
  type: AnnualReturnFollowUpType;
  recipientName: string;
  phone: string;
  suggestedTiming: string;
  messagePreview: string;
  status: AnnualReturnFollowUpStatus;
  blockedReason?: string;
};
```

Extend `AnnualReturnCase` with these fields after `reviewStatus`:

```ts
  packetRequirements: AnnualReturnPacketRequirement[];
  submission?: AnnualReturnSubmission;
  receipt?: AnnualReturnReceipt;
  sentFollowUpIds: string[];
```

- [ ] **Step 5: Add packet seed helpers**

Add these helpers before `buildCaseFromClient`:

```ts
function createDefaultPacketRequirements(
  overrides: Partial<Record<string, boolean>> = {},
): AnnualReturnPacketRequirement[] {
  const requirements = [
    ["nar1-draft", "NAR1 draft prepared"],
    ["company-particulars", "Company particulars checked"],
    ["scr-confirmed", "Significant controller register confirmed"],
    ["signed-nar1-attached", "Signed NAR1 attached"],
    ["payment-proof-checked", "Payment proof checked"],
    ["internal-filing-review", "Internal filing review approved"],
  ] as const;

  return requirements.map(([id, label]) => ({
    id,
    label,
    complete: overrides[id] ?? false,
    required: true,
  }));
}

function createReadyPacketRequirements(): AnnualReturnPacketRequirement[] {
  return createDefaultPacketRequirements({
    "nar1-draft": true,
    "company-particulars": true,
    "scr-confirmed": true,
    "signed-nar1-attached": true,
    "payment-proof-checked": true,
    "internal-filing-review": true,
  });
}

```

- [ ] **Step 6: Update clone and seed construction**

In `cloneAnnualReturnCase`, copy the new arrays and objects:

```ts
    packetRequirements: caseItem.packetRequirements.map((requirement) => ({ ...requirement })),
    submission: caseItem.submission ? { ...caseItem.submission } : undefined,
    receipt: caseItem.receipt ? { ...caseItem.receipt } : undefined,
    sentFollowUpIds: [...caseItem.sentFollowUpIds],
```

In `buildCaseFromClient`, add these fields before `notes`:

```ts
    packetRequirements:
      client.status === "Filed" || client.status === "Ready to file"
        ? createReadyPacketRequirements()
        : createDefaultPacketRequirements(),
    submission: client.status === "Filed"
      ? {
          reference: `NAR1-${client.annualReturnCaseId.toUpperCase()}-2026`,
          submittedAt: `${client.dueDate}T10:00:00.000Z`,
          submittedBy: owner,
        }
      : undefined,
    receipt: client.status === "Filed"
      ? {
          receiptNumber: `CR-${client.annualReturnCaseId.toUpperCase()}-2026`,
          acceptedAt: `${client.dueDate}T16:00:00.000Z`,
          acceptedBy: owner,
        }
      : undefined,
    sentFollowUpIds: [],
```

For the literal `ar-crestview` and `ar-delta` seeds, add these fields before `notes`:

```ts
    packetRequirements: createDefaultPacketRequirements(),
    sentFollowUpIds: [],
```

- [ ] **Step 7: Add packet derived helpers**

Add these exports before `getAnnualReturnAiContext`:

```ts
export function getPacketReadiness(caseItem: AnnualReturnCase): number {
  const required = caseItem.packetRequirements.filter((requirement) => requirement.required);
  if (required.length === 0) return 100;
  const complete = required.filter((requirement) => requirement.complete).length;
  return Math.round((complete / required.length) * 100);
}

export function getPacketBlockers(caseItem: AnnualReturnCase): string[] {
  if (caseItem.status === "filed") return [];
  return caseItem.packetRequirements
    .filter((requirement) => requirement.required && !requirement.complete)
    .map((requirement) => requirement.label);
}

export function getPacketStatus(caseItem: AnnualReturnCase): AnnualReturnPacketStatus {
  if (caseItem.receipt) return "accepted";
  if (caseItem.submission) return "submitted";
  const readiness = getPacketReadiness(caseItem);
  if (readiness === 0) return "not-started";
  if (readiness === 100 && getReadinessScore(caseItem) === 100) return "approved";
  if (readiness >= 80) return "ready-for-review";
  return "building";
}

function followUpTypeForBlocker(blocker: AnnualReturnBlocker): AnnualReturnFollowUpType {
  if (blocker.type === "payment") return "payment-reminder";
  if (blocker.type === "signature") return "signature-nudge";
  if (blocker.type === "review" || blocker.type === "owner") return "review-escalation";
  return "missing-document";
}

function followUpTiming(type: AnnualReturnFollowUpType): string {
  return {
    "missing-document": "Send today",
    "payment-reminder": "Send today",
    "signature-nudge": "Send before 5pm",
    "review-escalation": "Escalate internally",
    "packet-reminder": "Review before submission",
  }[type];
}

function followUpMessagePreview(
  caseItem: AnnualReturnCase,
  type: AnnualReturnFollowUpType,
  label: string,
): string {
  if (type === "review-escalation") {
    return `${caseItem.owner}, please clear "${label}" for ${caseItem.companyName} before filing.`;
  }

  return `Hi ${caseItem.contactName}, this is Kossilon. For ${caseItem.companyName}, we still need ${label.toLowerCase()} before we can complete the annual return filing.`;
}

export function getFollowUpDrafts(caseItem: AnnualReturnCase): AnnualReturnFollowUpDraft[] {
  const caseBlockerDrafts = getBlockers(caseItem).map((blocker) => {
    const type = followUpTypeForBlocker(blocker);
    const id = `follow-up-${caseItem.id}-${blocker.id}`;
    const sent = caseItem.sentFollowUpIds.includes(id);
    const blockedReason = caseItem.status === "filed" ? "Filed cases cannot send follow-ups" : undefined;

    return {
      id,
      caseId: caseItem.id,
      companyName: caseItem.companyName,
      type,
      recipientName: type === "review-escalation" ? caseItem.owner : caseItem.contactName,
      phone: caseItem.phone,
      suggestedTiming: followUpTiming(type),
      messagePreview: followUpMessagePreview(caseItem, type, blocker.label),
      status: sent ? "sent" : blockedReason ? "blocked" : "draft",
      blockedReason,
    } satisfies AnnualReturnFollowUpDraft;
  });

  const packetDrafts = getPacketBlockers(caseItem).map((label) => {
    const id = `follow-up-${caseItem.id}-packet-${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
    const sent = caseItem.sentFollowUpIds.includes(id);
    const blockedReason = caseItem.status === "filed" ? "Filed cases cannot send follow-ups" : undefined;

    return {
      id,
      caseId: caseItem.id,
      companyName: caseItem.companyName,
      type: "packet-reminder",
      recipientName: caseItem.owner,
      phone: caseItem.phone,
      suggestedTiming: followUpTiming("packet-reminder"),
      messagePreview: `${caseItem.owner}, packet item "${label}" is still open for ${caseItem.companyName}.`,
      status: sent ? "sent" : blockedReason ? "blocked" : "draft",
      blockedReason,
    } satisfies AnnualReturnFollowUpDraft;
  });

  return [...caseBlockerDrafts, ...packetDrafts];
}

export function canSendFollowUp(
  caseItem: AnnualReturnCase,
  draft: AnnualReturnFollowUpDraft,
): { ok: true } | { ok: false; reason: string } {
  if (caseItem.status === "filed") return { ok: false, reason: "Filed cases cannot send follow-ups" };
  if (caseItem.sentFollowUpIds.includes(draft.id) || draft.status === "sent") {
    return { ok: false, reason: "Follow-up has already been sent" };
  }
  const activeDraft = getFollowUpDrafts(caseItem).find((candidate) => candidate.id === draft.id);
  if (!activeDraft) return { ok: false, reason: "The original blocker has been resolved" };
  if (activeDraft.status === "blocked") {
    return { ok: false, reason: activeDraft.blockedReason ?? "Follow-up is blocked" };
  }
  return { ok: true };
}
```

- [ ] **Step 8: Add packet mutations**

Add these exports after `addCaseNote` and before `markFiled`:

```ts
export function togglePacketRequirement(caseId: string, requirementId: string): void {
  replaceCase(caseId, (caseItem) => {
    const requirement = caseItem.packetRequirements.find((item) => item.id === requirementId);
    if (caseItem.status === "filed") return caseItem;
    if (!requirement) return caseItem;

    const complete = !requirement.complete;

    return appendTimeline(
      {
        ...caseItem,
        packetRequirements: caseItem.packetRequirements.map((item) =>
          item.id === requirementId ? { ...item, complete } : item,
        ),
      },
      "Packet requirement updated",
      `${requirement.label} marked ${complete ? "complete" : "open"}.`,
    );
  });
}

export function sendFollowUpNow(
  caseId: string,
  draftId: string,
): { ok: true } | { ok: false; reason: string } {
  const caseItem = cases.find((candidate) => candidate.id === caseId);
  if (!caseItem) return { ok: false, reason: "Case not found" };

  const draft = getFollowUpDrafts(caseItem).find((candidate) => candidate.id === draftId);
  if (!draft) return { ok: false, reason: "The original blocker has been resolved" };

  const eligibility = canSendFollowUp(caseItem, draft);
  if (!eligibility.ok) return eligibility;

  replaceCase(caseId, (currentCase) =>
    appendTimeline(
      {
        ...currentCase,
        sentFollowUpIds: [...currentCase.sentFollowUpIds, draft.id],
      },
      "WhatsApp reminder sent",
      `${followUpTypeLabel(draft.type)} sent to ${draft.recipientName}: ${draft.messagePreview}`,
    ),
  );

  return { ok: true };
}

function followUpTypeLabel(type: AnnualReturnFollowUpType): string {
  return {
    "missing-document": "Missing document request",
    "payment-reminder": "Payment reminder",
    "signature-nudge": "Signature nudge",
    "review-escalation": "Review escalation",
    "packet-reminder": "Packet reminder",
  }[type];
}

export function submitFilingPacket(
  caseId: string,
): { ok: true; reference: string } | { ok: false; reason: string } {
  const caseItem = cases.find((candidate) => candidate.id === caseId);
  if (!caseItem) return { ok: false, reason: "Case not found" };
  if (caseItem.status === "filed") return { ok: false, reason: "Filed cases cannot be submitted" };
  if (caseItem.submission) return { ok: false, reason: "Packet has already been submitted" };

  const missing = getPacketBlockers(caseItem);
  if (getReadinessScore(caseItem) < 100) missing.unshift("case readiness is below 100%");
  if (missing.length > 0) {
    return { ok: false, reason: `Packet is not ready: ${missing.join("; ")}` };
  }

  const reference = `NAR1-${caseItem.id.toUpperCase()}-${Date.now().toString().slice(-6)}`;

  replaceCase(caseId, (currentCase) =>
    appendTimeline(
      {
        ...currentCase,
        submission: {
          reference,
          submittedAt: nowStamp(),
          submittedBy: currentCase.owner || "Operations",
        },
      },
      "Filing packet submitted",
      `Mock filing packet submitted with reference ${reference}.`,
    ),
  );

  return { ok: true, reference };
}

export function acceptFilingReceipt(
  caseId: string,
): { ok: true; receiptNumber: string } | { ok: false; reason: string } {
  const caseItem = cases.find((candidate) => candidate.id === caseId);
  if (!caseItem) return { ok: false, reason: "Case not found" };
  if (caseItem.status === "filed" && caseItem.receipt) {
    return { ok: false, reason: "Receipt has already been accepted" };
  }
  if (!caseItem.submission) return { ok: false, reason: "Packet must be submitted before receipt acceptance" };

  const receiptNumber = `CR-${caseItem.id.toUpperCase()}-${Date.now().toString().slice(-6)}`;

  replaceCase(caseId, (currentCase) =>
    appendTimeline(
      {
        ...currentCase,
        status: "filed",
        receipt: {
          receiptNumber,
          acceptedAt: nowStamp(),
          acceptedBy: currentCase.owner || "Operations",
        },
      },
      "Filing receipt accepted",
      `Mock Companies Registry receipt ${receiptNumber} accepted.`,
    ),
  );

  return { ok: true, receiptNumber };
}
```

- [ ] **Step 9: Run packet tests**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/lib/annual-return-store.test.ts
```

Expected: PASS for `src/lib/annual-return-store.test.ts`.

- [ ] **Step 10: Commit Task 1**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/lib/annual-return-store.ts src/lib/annual-return-store.test.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add annual return filing packet workflow"
```

Expected: commit succeeds.

---

### Task 2: Command Center And Case Detail Packet UI

**Files:**
- Modify: `src/routes/annual-returns.tsx`
- Modify: `src/routes/annual-returns.$id.tsx`

**Interfaces:**
- Consumes from Task 1:
  - `acceptFilingReceipt`
  - `canSendFollowUp`
  - `getFollowUpDrafts`
  - `getPacketReadiness`
  - `getPacketStatus`
  - `sendFollowUpNow`
  - `submitFilingPacket`
  - `togglePacketRequirement`
  - `type AnnualReturnFollowUpDraft`
  - `type AnnualReturnPacketStatus`
- Produces:
  - `/annual-returns` filters: `packet-ready` and `needs-follow-up`
  - `/annual-returns/$id` Filing Packet panel
  - `/annual-returns/$id` Follow-Ups panel

- [ ] **Step 1: Update command center imports**

In `src/routes/annual-returns.tsx`, extend the annual-return-store import:

```ts
  getFollowUpDrafts,
  getPacketReadiness,
  getPacketStatus,
  type AnnualReturnPacketStatus,
```

Change the filter state type:

```ts
const [filter, setFilter] = useState<
  "all" | "urgent" | "blocked" | "ready" | "packet-ready" | "needs-follow-up" | "filed"
>("all");
```

- [ ] **Step 2: Add command center filter logic**

In the `matchesFilter` expression, replace it with:

```ts
const followUps = getFollowUpDrafts(caseItem);
const matchesFilter =
  filter === "all" ||
  (filter === "urgent" && (risk === "overdue" || risk === "due-soon")) ||
  (filter === "blocked" && getBlockers(caseItem).length > 0 && risk !== "filed") ||
  (filter === "ready" && risk === "ready-to-file") ||
  (filter === "packet-ready" &&
    getPacketStatus(caseItem) === "approved" &&
    risk !== "filed") ||
  (filter === "needs-follow-up" &&
    followUps.some((draft) => draft.status === "draft")) ||
  (filter === "filed" && risk === "filed");
```

Update the filter button list:

```tsx
{(["all", "urgent", "blocked", "ready", "packet-ready", "needs-follow-up", "filed"] as const).map(
  (value) => (
    <button
      key={value}
      className={`rounded-md border px-3 py-2 text-sm ${
        filter === value ? "bg-primary text-primary-foreground" : "bg-background"
      }`}
      onClick={() => setFilter(value)}
      type="button"
    >
      {filterLabel(value)}
    </button>
  ),
)}
```

Add this helper near `riskLabel`:

```ts
function filterLabel(
  filter: "all" | "urgent" | "blocked" | "ready" | "packet-ready" | "needs-follow-up" | "filed",
): string {
  return {
    all: "All",
    urgent: "Urgent",
    blocked: "Blocked",
    ready: "Ready",
    "packet-ready": "Packet ready",
    "needs-follow-up": "Needs follow-up",
    filed: "Filed",
  }[filter];
}
```

- [ ] **Step 3: Add packet columns to the command center**

Update the desktop header grid class to include packet and follow-up columns:

```tsx
<div className="hidden grid-cols-[minmax(0,1.4fr)_110px_110px_130px_95px_110px_95px_1fr_95px_72px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
  <span>Company</span>
  <span>Owner</span>
  <span>Risk</span>
  <span>Due</span>
  <span>Case</span>
  <span>Packet</span>
  <span>Follow-ups</span>
  <span>Next action</span>
  <span>Payment</span>
  <span className="text-right">Open</span>
</div>
```

In `CaseRow`, add these derivations:

```ts
const packetReadiness = getPacketReadiness(caseItem);
const packetStatus = getPacketStatus(caseItem);
const followUps = getFollowUpDrafts(caseItem);
const openFollowUps = followUps.filter((draft) => draft.status === "draft").length;
```

Replace the row grid class with:

```tsx
<div className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.4fr)_110px_110px_130px_95px_110px_95px_1fr_95px_72px] lg:items-center">
```

Render these fields between Due and Next action:

```tsx
<Field label="Case" value={`${readiness}%`} />
<Field label="Packet" value={`${packetLabel(packetStatus)} / ${packetReadiness}%`} />
<Field label="Follow-ups" value={openFollowUps === 0 ? "None" : `${openFollowUps} open`} />
```

Add this helper:

```ts
function packetLabel(status: AnnualReturnPacketStatus): string {
  return {
    "not-started": "Not started",
    building: "Building",
    "ready-for-review": "Review",
    approved: "Approved",
    submitted: "Submitted",
    accepted: "Accepted",
  }[status];
}
```

- [ ] **Step 4: Update detail route imports and local warnings**

In `src/routes/annual-returns.$id.tsx`, add these imports from `../lib/annual-return-store`:

```ts
  type AnnualReturnFollowUpDraft,
  type AnnualReturnCase,
  type AnnualReturnPacketStatus,
  acceptFilingReceipt,
  canSendFollowUp,
  getFollowUpDrafts,
  getPacketReadiness,
  getPacketStatus,
  sendFollowUpNow,
  submitFilingPacket,
  togglePacketRequirement,
```

Add local state after `filingWarning`:

```ts
const [packetWarning, setPacketWarning] = useState<string | undefined>();
const [followUpWarning, setFollowUpWarning] = useState<string | undefined>();
```

Reset it in the `useEffect`:

```ts
setPacketWarning(undefined);
setFollowUpWarning(undefined);
```

Add derivations after `isFiled`:

```ts
const packetReadiness = getPacketReadiness(caseItem);
const packetStatus = getPacketStatus(caseItem);
const followUps = getFollowUpDrafts(caseItem);
```

- [ ] **Step 5: Add the Filing Packet panel**

Place this section after the existing Blockers section and before Checklist:

```tsx
<section className="rounded-lg border bg-card p-4">
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 className="text-lg font-semibold">Filing packet</h2>
      <p className="text-sm text-muted-foreground">
        Assemble the mocked NAR1 packet before submission.
      </p>
    </div>
    <div className="text-right">
      <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${packetToneClass(packetStatus)}`}>
        {packetStatusLabel(packetStatus)}
      </span>
      <p className="mt-1 text-sm text-muted-foreground">{packetReadiness}% packet ready</p>
    </div>
  </div>

  <div className="mt-4 space-y-2">
    {caseItem.packetRequirements.map((requirement) => (
      <button
        key={requirement.id}
        className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        disabled={isFiled}
        onClick={() => {
          setPacketWarning(undefined);
          togglePacketRequirement(caseItem.id, requirement.id);
        }}
        type="button"
      >
        <span>{requirement.label}</span>
        <span>{requirement.complete ? "Complete" : "Open"}</span>
      </button>
    ))}
  </div>

  {caseItem.submission ? (
    <div className="mt-4 rounded-md border bg-background px-3 py-3 text-sm">
      <p className="font-medium">Submitted reference</p>
      <p className="text-muted-foreground">{caseItem.submission.reference}</p>
    </div>
  ) : null}

  {caseItem.receipt ? (
    <div className="mt-3 rounded-md border bg-background px-3 py-3 text-sm">
      <p className="font-medium">Receipt accepted</p>
      <p className="text-muted-foreground">{caseItem.receipt.receiptNumber}</p>
    </div>
  ) : null}

  {packetWarning ? (
    <div className="mt-4 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
      {packetWarning}
    </div>
  ) : null}

  <div className="mt-4 flex flex-wrap justify-end gap-2">
    <button
      className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
      disabled={isFiled || Boolean(caseItem.submission)}
      onClick={() => {
        const result = submitFilingPacket(caseItem.id);
        setPacketWarning(result.ok ? undefined : result.reason);
      }}
      type="button"
    >
      Submit packet
    </button>
    <button
      className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
      disabled={isFiled || !caseItem.submission || Boolean(caseItem.receipt)}
      onClick={() => {
        const result = acceptFilingReceipt(caseItem.id);
        setPacketWarning(result.ok ? undefined : result.reason);
      }}
      type="button"
    >
      Accept receipt
    </button>
  </div>
</section>
```

- [ ] **Step 6: Add the Follow-Ups panel**

Place this section after the new Filing Packet panel:

```tsx
<section className="rounded-lg border bg-card p-4">
  <div className="flex items-center justify-between gap-3">
    <div>
      <h2 className="text-lg font-semibold">Follow-ups</h2>
      <p className="text-sm text-muted-foreground">
        Mock WhatsApp reminders generated from current blockers.
      </p>
    </div>
    <span className="text-sm text-muted-foreground">
      {followUps.filter((draft) => draft.status === "draft").length} open
    </span>
  </div>

  {followUpWarning ? (
    <div className="mt-4 rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
      {followUpWarning}
    </div>
  ) : null}

  <div className="mt-4 space-y-3">
    {followUps.length === 0 ? (
      <p className="text-sm text-muted-foreground">No follow-ups are needed.</p>
    ) : (
      followUps.map((draft) => (
        <FollowUpCard
          key={draft.id}
          caseItem={caseItem}
          draft={draft}
          onSend={() => {
            const result = sendFollowUpNow(caseItem.id, draft.id);
            setFollowUpWarning(result.ok ? undefined : result.reason);
          }}
        />
      ))
    )}
  </div>
</section>
```

Add the component and helpers near the bottom of the file:

```tsx
function FollowUpCard({
  caseItem,
  draft,
  onSend,
}: {
  caseItem: AnnualReturnCase;
  draft: AnnualReturnFollowUpDraft;
  onSend: () => void;
}) {
  const eligibility = canSendFollowUp(caseItem, draft);
  const disabled = !eligibility.ok;

  return (
    <div className="rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{followUpTypeLabel(draft.type)}</p>
          <p className="text-sm text-muted-foreground">
            {draft.recipientName} / {draft.phone} / {draft.suggestedTiming}
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
          {draft.status}
        </span>
      </div>
      <p className="mt-3 text-sm">{draft.messagePreview}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {disabled ? eligibility.reason : "Ready to mock-send"}
        </p>
        <button
          className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          disabled={disabled}
          onClick={onSend}
          type="button"
        >
          Send now
        </button>
      </div>
    </div>
  );
}

function followUpTypeLabel(type: AnnualReturnFollowUpDraft["type"]): string {
  return {
    "missing-document": "Missing document request",
    "payment-reminder": "Payment reminder",
    "signature-nudge": "Signature nudge",
    "review-escalation": "Review escalation",
    "packet-reminder": "Packet reminder",
  }[type];
}

function packetStatusLabel(status: AnnualReturnPacketStatus): string {
  return {
    "not-started": "Not started",
    building: "Building",
    "ready-for-review": "Ready for review",
    approved: "Approved",
    submitted: "Submitted",
    accepted: "Accepted",
  }[status];
}

function packetToneClass(status: AnnualReturnPacketStatus): string {
  return {
    "not-started": "bg-slate-100 text-slate-700",
    building: "bg-yellow-100 text-yellow-800",
    "ready-for-review": "bg-orange-100 text-orange-700",
    approved: "bg-green-100 text-green-700",
    submitted: "bg-blue-100 text-blue-700",
    accepted: "bg-blue-100 text-blue-700",
  }[status];
}
```

- [ ] **Step 7: Run static checks**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' run lint
```

Expected: PASS with the existing Fast Refresh warnings only.

- [ ] **Step 8: Run store tests**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test -- src/lib/annual-return-store.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/routes/annual-returns.tsx "src/routes/annual-returns.$id.tsx"
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add filing packet case surfaces"
```

Expected: commit succeeds.

---

### Task 3: WhatsApp Automation Queue And Verification

**Files:**
- Modify: `src/routes/whatsapp.automation.tsx`
- Review: `src/lib/annual-return-store.ts`
- Review: `src/routes/annual-returns.tsx`
- Review: `src/routes/annual-returns.$id.tsx`

**Interfaces:**
- Consumes from Task 1:
  - `getFollowUpDrafts`
  - `sendFollowUpNow`
  - `useAnnualReturnCases`
  - `type AnnualReturnFollowUpDraft`
  - `type AnnualReturnCase`
- Produces:
  - Cross-case follow-up queue at `/whatsapp/automation`
  - Shared Send now mutation path from automation queue to case timeline
  - Final verified implementation

- [ ] **Step 1: Replace the current automation route content**

Replace `src/routes/whatsapp.automation.tsx` with this implementation:

```tsx
import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import {
  getFollowUpDrafts,
  sendFollowUpNow,
  useAnnualReturnCases,
  type AnnualReturnCase,
  type AnnualReturnFollowUpDraft,
} from "../lib/annual-return-store";

export const Route = createFileRoute("/whatsapp/automation")({
  component: WhatsAppAutomationRoute,
});

function WhatsAppAutomationRoute() {
  const cases = useAnnualReturnCases();
  const [filter, setFilter] = useState<"open" | "sent" | "all">("open");
  const [warning, setWarning] = useState<string | undefined>();

  const rows = useMemo(() => {
    return cases.flatMap((caseItem) =>
      getFollowUpDrafts(caseItem).map((draft) => ({ caseItem, draft })),
    );
  }, [cases]);

  const visibleRows = rows.filter(({ draft }) => {
    if (filter === "open") return draft.status === "draft";
    if (filter === "sent") return draft.status === "sent";
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">WhatsApp</p>
          <h1 className="mt-1 text-3xl font-semibold">Automation</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["open", "sent", "all"] as const).map((value) => (
            <button
              key={value}
              className={`rounded-md border px-3 py-2 text-sm ${
                filter === value ? "bg-primary text-primary-foreground" : "bg-background"
              }`}
              onClick={() => setFilter(value)}
              type="button"
            >
              {value === "open" ? "Open" : value === "sent" ? "Sent" : "All"}
            </button>
          ))}
        </div>
      </div>

      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          {warning}
        </div>
      ) : null}

      <section className="rounded-lg border bg-card">
        <div className="hidden grid-cols-[1.2fr_1fr_140px_120px_minmax(0,1.5fr)_120px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Company</span>
          <span>Recipient</span>
          <span>Type</span>
          <span>Timing</span>
          <span>Preview</span>
          <span className="text-right">Action</span>
        </div>

        <div className="divide-y">
          {visibleRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No follow-ups match this filter.</p>
          ) : (
            visibleRows.map(({ caseItem, draft }) => (
              <AutomationRow
                key={draft.id}
                caseItem={caseItem}
                draft={draft}
                onSend={() => {
                  const result = sendFollowUpNow(caseItem.id, draft.id);
                  setWarning(result.ok ? undefined : result.reason);
                }}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function AutomationRow({
  caseItem,
  draft,
  onSend,
}: {
  caseItem: AnnualReturnCase;
  draft: AnnualReturnFollowUpDraft;
  onSend: () => void;
}) {
  const disabled = draft.status !== "draft";

  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.2fr_1fr_140px_120px_minmax(0,1.5fr)_120px] lg:items-center">
      <div className="min-w-0">
        <Link
          className="font-medium hover:underline"
          to="/annual-returns/$id"
          params={{ id: caseItem.id }}
        >
          {caseItem.companyName}
        </Link>
        <p className="text-muted-foreground">{caseItem.owner}</p>
      </div>
      <Field label="Recipient" value={`${draft.recipientName} / ${draft.phone}`} />
      <Field label="Type" value={followUpTypeLabel(draft.type)} />
      <Field label="Timing" value={draft.suggestedTiming} />
      <Field label="Preview" value={draft.messagePreview} />
      <div className="flex justify-start lg:justify-end">
        <button
          className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          disabled={disabled}
          onClick={onSend}
          type="button"
        >
          {draft.status === "sent" ? "Sent" : draft.status === "blocked" ? "Blocked" : "Send now"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <p className="truncate">{value}</p>
    </div>
  );
}

function followUpTypeLabel(type: AnnualReturnFollowUpDraft["type"]): string {
  return {
    "missing-document": "Document",
    "payment-reminder": "Payment",
    "signature-nudge": "Signature",
    "review-escalation": "Review",
    "packet-reminder": "Packet",
  }[type];
}
```

- [ ] **Step 2: Run full tests**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' run lint
```

Expected: PASS with the existing Fast Refresh warnings only.

- [ ] **Step 4: Run build**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Expected: PASS.

- [ ] **Step 5: Manual source verification**

Run:

```powershell
if (Get-Command rg -ErrorAction SilentlyContinue) {
  rg -n "getPacketReadiness|getPacketStatus|getFollowUpDrafts|sendFollowUpNow|submitFilingPacket|acceptFilingReceipt" src
}
```

Expected:

- `src/lib/annual-return-store.ts` exports all helpers/mutations.
- `src/lib/annual-return-store.test.ts` covers all helpers/mutations.
- `src/routes/annual-returns.tsx` uses packet readiness/status and follow-up drafts.
- `src/routes/annual-returns.$id.tsx` uses packet/follow-up mutations.
- `src/routes/whatsapp.automation.tsx` uses follow-up drafts and Send now.

- [ ] **Step 6: Optional browser verification**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' run dev
```

Expected: dev server prints a local URL.

Verify:

- `/annual-returns` shows packet status/readiness and follow-up count.
- `Packet ready` filter shows approved packet cases.
- `Needs follow-up` filter shows cases with draft follow-ups.
- `/annual-returns/ar-delta` shows Filing Packet and Follow-Ups panels.
- Completing packet requirements updates packet readiness.
- Submitting an incomplete packet shows the missing requirements warning.
- Completing case readiness and packet requirements allows Submit packet.
- Accept receipt marks the case filed.
- Send now from case detail writes a timeline event.
- `/whatsapp/automation` lists the same drafts.
- Send now from `/whatsapp/automation` writes to the linked case timeline.

Stop the dev server before finishing the task.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/routes/whatsapp.automation.tsx src/lib/annual-return-store.ts src/lib/annual-return-store.test.ts src/routes/annual-returns.tsx "src/routes/annual-returns.$id.tsx"
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add annual return follow-up automation queue"
```

Expected: commit succeeds.

---

### Task 4: Final Review And PR Update

**Files:**
- Review: `src/lib/annual-return-store.ts`
- Review: `src/lib/annual-return-store.test.ts`
- Review: `src/routes/annual-returns.tsx`
- Review: `src/routes/annual-returns.$id.tsx`
- Review: `src/routes/whatsapp.automation.tsx`
- Review: `docs/superpowers/specs/2026-07-08-filing-packet-follow-up-automation-design.md`
- Review: `docs/superpowers/plans/2026-07-08-filing-packet-follow-up-automation.md`

**Interfaces:**
- Consumes all prior task outputs.
- Produces a verified branch ready to push onto the existing PR branch.

- [ ] **Step 1: Check branch status**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' status -sb
```

Expected: either clean or only expected final artifacts.

- [ ] **Step 2: Run final verification commands**

Run:

```powershell
$env:PATH='C:\Program Files\nodejs;' + $env:PATH
& 'C:\Program Files\nodejs\npm.cmd' test
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Expected:

- Tests PASS.
- Lint PASS with existing Fast Refresh warnings only.
- Build PASS.

- [ ] **Step 3: Review diff scope**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' diff --stat HEAD~3..HEAD
& 'C:\Program Files\Git\cmd\git.exe' status -sb
```

Expected diff is limited to:

- Annual return store and tests.
- Annual returns list/detail routes.
- WhatsApp automation route.
- New spec/plan docs.

- [ ] **Step 4: Push the branch**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' push
```

Expected: existing PR branch updates successfully.

- [ ] **Step 5: Final response**

Report:

- PR branch name.
- Commit range or newest commit hash.
- Verification commands and outcomes.
- Any remaining warnings.
- Whether browser verification ran.
