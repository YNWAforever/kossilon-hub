import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  assertDocumentServable,
  canApproveDocument,
  canServeDocumentBytes,
  documentSafetyOf,
} from "./safety";

function actor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    authUserId: "auth",
    userId: "70000000-0000-4000-8000-000000000001",
    role: "Staff",
    teamId: "80000000-0000-4000-8000-000000000001",
    active: true,
    ...overrides,
  };
}

describe("documentSafetyOf", () => {
  it("treats a provider verdict on an available file as verified", () => {
    expect(documentSafetyOf({ uploadStatus: "available", scanVerdictSource: "provider" })).toBe(
      "verified",
    );
  });

  // The whole point of the column: the deterministic scanner returns "clean" for
  // every input, so its verdict is evidence of nothing.
  it("treats a deterministic verdict as unknown, not verified", () => {
    expect(
      documentSafetyOf({ uploadStatus: "available", scanVerdictSource: "deterministic" }),
    ).toBe("unknown");
  });

  it("treats a missing verdict source as unknown, because it predates the distinction", () => {
    expect(documentSafetyOf({ uploadStatus: "available", scanVerdictSource: null })).toBe(
      "unknown",
    );
  });

  it("reports a quarantined file as pending", () => {
    expect(documentSafetyOf({ uploadStatus: "quarantined", scanVerdictSource: null })).toBe(
      "pending",
    );
  });

  it("reports a rejected file as unsafe even if a stale verdict source lingers", () => {
    expect(documentSafetyOf({ uploadStatus: "rejected", scanVerdictSource: "provider" })).toBe(
      "unsafe",
    );
  });

  it("reports a failed scan as pending rather than anything releasable", () => {
    expect(documentSafetyOf({ uploadStatus: "failed", scanVerdictSource: null })).toBe("pending");
  });
});

describe("canServeDocumentBytes", () => {
  it("serves a genuinely scanned file to ordinary staff", () => {
    expect(canServeDocumentBytes(actor(), "verified")).toBe(true);
  });

  it("refuses an unknown-safety file to ordinary staff", () => {
    expect(canServeDocumentBytes(actor(), "unknown")).toBe(false);
  });

  it("refuses an unknown-safety file to a manager", () => {
    expect(canServeDocumentBytes(actor({ role: "Manager" }), "unknown")).toBe(false);
  });

  // A corrected, narrower policy rather than a grandfathered permission: an
  // operator keeps the access they need to handle an incident.
  it("refuses unknown bytes in ordinary preview/download even to an Admin", () => {
    expect(canServeDocumentBytes(actor({ role: "Admin" }), "unknown")).toBe(false);
  });

  it("refuses malware to everyone, admin included", () => {
    expect(canServeDocumentBytes(actor({ role: "Admin" }), "unsafe")).toBe(false);
  });

  it("refuses a pending file to everyone, admin included", () => {
    expect(canServeDocumentBytes(actor({ role: "Admin" }), "pending")).toBe(false);
  });
});

describe("assertDocumentServable", () => {
  it("passes a verified file", () => {
    expect(() => assertDocumentServable(actor(), "verified")).not.toThrow();
  });

  it("names malware rejection distinctly from an unfinished scan", () => {
    expect(() => assertDocumentServable(actor(), "unsafe")).toThrow(
      /rejected by malware scanning/i,
    );
    expect(() => assertDocumentServable(actor(), "pending")).toThrow(/pending a malware scan/i);
  });

  it("requires verified lineage and a genuine scan without inventing a queued re-scan", () => {
    expect(() => assertDocumentServable(actor(), "unknown")).toThrow(
      /unverified.*upload lineage.*genuine scan/i,
    );
  });
});

describe("canApproveDocument", () => {
  // Stricter than serving: an approval is what later releases a document to a
  // client and into a filing package.
  it("permits approval only on a genuine provider verdict", () => {
    expect(canApproveDocument("verified")).toBe(true);
    expect(canApproveDocument("unknown")).toBe(false);
    expect(canApproveDocument("pending")).toBe(false);
    expect(canApproveDocument("unsafe")).toBe(false);
  });
});
