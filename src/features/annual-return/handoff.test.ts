import { describe, expect, it } from "vitest";
import {
  isOpenException,
  reconcileReturn,
  refusalForHandoff,
  summarizeExceptions,
  type HandoffState,
  type ReturnState,
  handoffFactLabel,
} from "./handoff";

const MANIFEST_A = "a".repeat(64);
const MANIFEST_B = "b".repeat(64);
const allowedReadiness = {
  sourceVersion: "a".repeat(32),
  readyToPrepare: true,
  readyForApproval: true,
  readyToTransmit: true,
  manifestPayload: null,
  blockers: [],
};

function handoff(overrides: Partial<HandoffState> = {}): HandoffState {
  return {
    id: "handoff-1",
    caseId: "case-1",
    manifestSha256: MANIFEST_A,
    status: "prepared",
    transmittedAt: null,
    ...overrides,
  };
}

function returned(overrides: Partial<ReturnState> = {}): ReturnState {
  return {
    id: "return-1",
    handoffId: "handoff-1",
    outcome: "accepted",
    reconciledAt: "2026-09-11T02:00:00.000Z",
    ...overrides,
  };
}

describe("refusalForHandoff", () => {
  it("unknown external outcome remains blocked even if the legacy enum says failed", () => {
    expect(
      refusalForHandoff({
        existing: handoff({ status: "failed", deliveryFact: "unknown" }),
        approvedManifestSha256: MANIFEST_A,
        currentManifestSha256: MANIFEST_A,
        readiness: allowedReadiness,
      }),
    ).toMatchObject({ kind: "already-out" });
  });
  it("refuses a matching package when actual case readiness is missing or blocked", () => {
    for (const readiness of [null, { ...allowedReadiness, readyToTransmit: false }]) {
      expect(
        refusalForHandoff({
          existing: null,
          approvedManifestSha256: MANIFEST_A,
          currentManifestSha256: MANIFEST_A,
          readiness,
        }),
      ).toMatchObject({ kind: "case-not-ready" });
    }
  });
  it("allows a first handoff whose manifest still matches the approval", () => {
    expect(
      refusalForHandoff({
        existing: null,
        approvedManifestSha256: MANIFEST_A,
        currentManifestSha256: MANIFEST_A,
        readiness: allowedReadiness,
      }),
    ).toBeNull();
  });

  // A second package for a case already out with the agent is a mistake, not a
  // second filing.
  it("refuses while a package is already out", () => {
    for (const status of ["prepared", "transmitted", "acknowledged"] as const) {
      expect(
        refusalForHandoff({
          existing: handoff({ status }),
          approvedManifestSha256: MANIFEST_A,
          currentManifestSha256: MANIFEST_A,
          readiness: allowedReadiness,
        }),
      ).toMatchObject({ kind: "already-out", status });
    }
  });

  it("allows a replacement once the previous one failed or was withdrawn", () => {
    for (const status of ["failed", "cancelled", "returned"] as const) {
      expect(
        refusalForHandoff({
          existing: handoff({ status, transmittedAt: null }),
          approvedManifestSha256: MANIFEST_A,
          currentManifestSha256: MANIFEST_A,
          readiness: allowedReadiness,
        }),
      ).toBeNull();
    }
  });

  /**
   * The evidence moved after the approval. Sending the current package files
   * something nobody approved; sending the approved one files something the case
   * no longer contains. Neither is the system's to choose.
   */
  it("refuses when the package no longer matches what was approved", () => {
    expect(
      refusalForHandoff({
        existing: null,
        approvedManifestSha256: MANIFEST_A,
        currentManifestSha256: MANIFEST_B,
        readiness: allowedReadiness,
      }),
    ).toMatchObject({ kind: "manifest-changed" });
  });
});
describe("handoff fact disclosure", () => {
  it("manual record/export never claims provider or regulatory acceptance", () => {
    expect(handoffFactLabel("manual_recorded")).toContain("人工");
    expect(handoffFactLabel("manual_recorded")).not.toContain("已受理");
    expect(handoffFactLabel("exported")).toContain("未提交");
    expect(handoffFactLabel("provider_accepted")).toContain("不代表監管");
  });
});

describe("reconcileReturn", () => {
  it("matches a return carrying the manifest that was sent", () => {
    expect(reconcileReturn({ handoff: handoff(), returnedManifestSha256: MANIFEST_A })).toEqual({
      kind: "matches",
    });
  });

  /**
   * A destination returning a reference we never sent means either the agent has
   * mixed up two clients' filings or somebody is replaying our submission back at
   * us. Both need a person; neither is a discrepancy to absorb.
   */
  it("refuses to match a return for a handoff that does not exist", () => {
    expect(reconcileReturn({ handoff: null, returnedManifestSha256: MANIFEST_A })).toEqual({
      kind: "unmatched",
      reason: "no-such-handoff",
    });
  });

  it("refuses to match a return quoting a different package", () => {
    expect(
      reconcileReturn({ handoff: handoff(), returnedManifestSha256: MANIFEST_B }),
    ).toMatchObject({ kind: "unmatched", reason: "manifest-mismatch" });
  });

  // `matches` is a claim about identity. Absence of a reference is absence of
  // evidence for it, not evidence for it.
  it("does not treat a missing reference as a match", () => {
    expect(reconcileReturn({ handoff: handoff(), returnedManifestSha256: null })).toMatchObject({
      kind: "unmatched",
    });
  });
});

describe("isOpenException", () => {
  /**
   * The agent saying "accepted" is the agent's claim. Reconciling it against the
   * manifest is how the firm checks, so an unreconciled return is open however
   * benign it looks.
   */
  it("keeps an unreconciled return open even when the agent accepted it", () => {
    expect(isOpenException(returned({ outcome: "accepted", reconciledAt: null }))).toBe(true);
  });

  it("closes a reconciled acceptance", () => {
    expect(isOpenException(returned({ outcome: "accepted" }))).toBe(false);
  });

  // Reconciling establishes what happened; it does not resolve it.
  it("keeps a rejection open after reconciliation", () => {
    for (const outcome of ["rejected", "partial", "unmatched"] as const) {
      expect(isOpenException(returned({ outcome }))).toBe(true);
    }
  });
});

describe("summarizeExceptions", () => {
  it("counts returns awaiting a person", () => {
    const summary = summarizeExceptions({
      handoffs: [],
      returns: [
        returned({ id: "r1", reconciledAt: null }),
        returned({ id: "r2", outcome: "rejected" }),
        returned({ id: "r3" }),
      ],
    });
    expect(summary.open).toBe(2);
  });

  /**
   * Under BLOCKED_INTEGRATION: external-handoff-destination this is every
   * prepared package. Folding it into the exception count would report a fault
   * where there is a missing integration; omitting it would show an empty list
   * that reads as "nothing outstanding".
   */
  it("counts packages nothing can transmit separately from exceptions", () => {
    const summary = summarizeExceptions({
      handoffs: [handoff({ id: "h1" }), handoff({ id: "h2" })],
      returns: [],
    });
    expect(summary).toEqual({ open: 0, awaitingTransmission: 2 });
  });

  it("does not count a transmitted package as awaiting transmission", () => {
    const summary = summarizeExceptions({
      handoffs: [handoff({ status: "transmitted", transmittedAt: "2026-09-11T02:00:00.000Z" })],
      returns: [],
    });
    expect(summary.awaitingTransmission).toBe(0);
  });
});
