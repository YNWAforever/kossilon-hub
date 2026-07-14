import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertDocumentCompanyAccess, validateDocumentUploadRequest } from "./repository";

const companyId = "10000000-0000-0000-0000-000000000001";

describe("document repository policy", () => {
  it("enforces extension, MIME, checksum, and size before storage", () => {
    expect(() =>
      validateDocumentUploadRequest({
        category: "identity",
        fileName: "passport.exe",
        contentType: "application/pdf",
        sizeBytes: 20,
        checksum: "a".repeat(64),
      }),
    ).toThrow(/extension/i);
    expect(() =>
      validateDocumentUploadRequest({
        category: "identity",
        fileName: "passport.pdf",
        contentType: "image/png",
        sizeBytes: 20,
        checksum: "a".repeat(64),
      }),
    ).toThrow(/content type/i);
    expect(() =>
      validateDocumentUploadRequest({
        category: "identity",
        fileName: "passport.pdf",
        contentType: "application/pdf",
        sizeBytes: 0,
        checksum: "bad",
      }),
    ).toThrow(/size/i);
  });

  it("allows verified staff in the firm and active client memberships only", () => {
    const staff: AuthenticatedActor = {
      authUserId: "staff-auth",
      userId: "20000000-0000-0000-0000-000000000001",
      role: "Staff",
      teamId: null,
      active: true,
    };
    const client: AuthenticatedActor = {
      authUserId: "client-auth",
      userId: null,
      role: "Client",
      teamId: null,
      active: true,
    };

    expect(assertDocumentCompanyAccess(staff, companyId, [])).toBe(staff);
    expect(assertDocumentCompanyAccess(client, companyId, [{ companyId, active: true }])).toBe(
      client,
    );
    expect(() =>
      assertDocumentCompanyAccess(client, companyId, [
        { companyId: "10000000-0000-0000-0000-000000000002", active: true },
      ]),
    ).toThrow(/membership/i);
  });
});
