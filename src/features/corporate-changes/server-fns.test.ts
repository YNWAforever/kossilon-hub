import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCorporateChangeRequestSchema } from "./server-fns";

// A thin authorization-focused test that calls the exported `createServerFn` handlers
// directly (mocking `@/features/auth/neon-auth-server`) is not viable against the installed
// `@tanstack/react-start` (1.168.x): its compiled `.handler()` wrapper always resolves through
// `getStartContextServerOnly()` (an AsyncLocalStorage context only populated while an actual
// HTTP request is being served), so invoking the export directly throws "No Start context
// found in AsyncLocalStorage" before the mocked `requireStaffActor` — or even our own
// `getRequest()` call — is ever reached. Neither `src/features/clients/server-fns.ts` nor
// `src/features/incorporation/server-fns.ts` (the two "thin wrapper" siblings this file
// mirrors) has a test file, for the same reason: their authorization logic already has
// dedicated coverage in `authorization.test.ts`, and CLAUDE.md's testability convention is to
// keep server fns thin and test the pure logic they call, not the createServerFn wrapper
// itself. `src/features/work-items/server-fns.ts` sidesteps this by exporting pure,
// dependency-injected functions for its authorization checks; this file follows the
// clients/incorporation shape instead, so it has no equivalent pure export to unit test here.
//
// This test instead verifies the property the prescribed test was protecting — that a write
// can never be authorized from client-supplied data — using the same source-inspection
// approach `src/features/work-items/server-fns.test.ts` uses for its lazy-loading convention.
describe("corporate change request server function authorization wiring", () => {
  const source = readFileSync(new URL("./server-fns.ts", import.meta.url), "utf8");

  it("loads request/actor/repository access only inside the server runtime", () => {
    expect(source).not.toContain('import { getRequest } from "@tanstack/react-start/server"');
    expect(source).not.toContain(
      'import { requireStaffActor } from "@/features/auth/neon-auth-server"',
    );
    expect(source).not.toContain("import { createCorporateChangeRequestRepository");
    expect(source).toContain("createServerOnlyFn");
    expect(source).toContain('import("@tanstack/react-start/server")');
    expect(source).toContain('import("@/features/auth/neon-auth-server")');
  });

  it("derives the write actor from the request and checks writability before mutating", () => {
    expect(source).toContain("assertCorporateChangeRequestWritable");
    expect(source).toContain("requireWritableRequestCompany");
    // Every mutating handler resolves `actorId` from `requireWritableRequestCompany`'s return
    // value, never from client-supplied `data` — guard against a caller smuggling their own
    // `actorId`/`role` through the validator and having it win the later spread.
    expect(source).not.toMatch(/data\.actorId|data\.role/);
  });
});

describe("createCorporateChangeRequestSchema", () => {
  const companyId = "00000000-0000-0000-0000-000000000001";
  const transferorShareholdingId = "00000000-0000-0000-0000-000000000002";
  const transfereeShareholdingId = "00000000-0000-0000-0000-000000000003";

  const shareTransferBase = {
    changeType: "share_transfer" as const,
    companyId,
    quotedFee: 3000,
    transferorShareholdingId,
    sharesTransferred: 10,
    consideration: 100,
    stampDutyAmount: 1,
  };

  it("accepts an address_change payload", () => {
    expect(
      createCorporateChangeRequestSchema.safeParse({
        changeType: "address_change",
        companyId,
        quotedFee: 2800,
        newRegisteredOffice: "88 New Road, Hong Kong",
      }).success,
    ).toBe(true);
  });

  it("rejects a share_transfer naming neither an existing transferee nor a new shareholder", () => {
    const result = createCorporateChangeRequestSchema.safeParse({
      ...shareTransferBase,
      transfereeShareholdingId: null,
      transfereeNewShareholderName: null,
      transfereeNewShareholderAddress: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a share_transfer naming both an existing transferee and a new shareholder", () => {
    const result = createCorporateChangeRequestSchema.safeParse({
      ...shareTransferBase,
      transfereeShareholdingId,
      transfereeNewShareholderName: "New Holder Ltd",
      transfereeNewShareholderAddress: "1 Address Road",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a share_transfer naming exactly one of an existing transferee or a new shareholder", () => {
    expect(
      createCorporateChangeRequestSchema.safeParse({
        ...shareTransferBase,
        transfereeShareholdingId,
        transfereeNewShareholderName: null,
        transfereeNewShareholderAddress: null,
      }).success,
    ).toBe(true);
    expect(
      createCorporateChangeRequestSchema.safeParse({
        ...shareTransferBase,
        transfereeShareholdingId: null,
        transfereeNewShareholderName: "New Holder Ltd",
        transfereeNewShareholderAddress: "1 Address Road",
      }).success,
    ).toBe(true);
  });
});
