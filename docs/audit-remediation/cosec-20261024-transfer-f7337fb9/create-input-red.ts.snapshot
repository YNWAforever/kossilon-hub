import { describe, expect, it } from "vitest";
import { createCorporateChangeRequestSchema } from "./server-fns";

const base = {
  changeType: "share_transfer" as const,
  companyId: "f7337fb9-0166-4166-8166-000000000001",
  quotedFee: 2500,
  transferorShareholdingId: "f7337fb9-0166-4166-8166-000000000002",
  transfereeShareholdingId: null,
  transfereeNewShareholderName: "QA UC166 new holder",
  transfereeNewShareholderAddress: null,
  sharesTransferred: 10,
  consideration: 0,
  stampDutyAmount: 0,
};
describe("UC166 share transfer field validation", () => {
  it.each([null, "", "   ", "\t\n"])("rejects missing/blank new holder %j", (name) => {
    const result = createCorporateChangeRequestSchema.safeParse({
      ...base,
      transfereeNewShareholderName: name,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toContain(
        "transfereeNewShareholderName",
      );
    }
  });
  it("reports both fields for ambiguous dual transferees", () => {
    const result = createCorporateChangeRequestSchema.safeParse({
      ...base,
      transfereeShareholdingId: "f7337fb9-0166-4166-8166-000000000003",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(["transfereeShareholdingId", "transfereeNewShareholderName"]),
      );
    }
  });
  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, 2147483648, Number.MAX_SAFE_INTEGER])(
    "rejects invalid quantity %s at its field",
    (sharesTransferred) => {
      const result = createCorporateChangeRequestSchema.safeParse({ ...base, sharesTransferred });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path[0])).toContain("sharesTransferred");
      }
    },
  );
  it("trims a new holder name and accepts the storage integer boundary", () => {
    const result = createCorporateChangeRequestSchema.parse({
      ...base,
      transfereeNewShareholderName: "  QA UC166 new holder  ",
      sharesTransferred: 2147483647,
    });
    expect(result).toMatchObject({ transfereeNewShareholderName: "QA UC166 new holder" });
  });
  it("existing holder plus an empty new-holder field is unambiguous", () => {
    expect(
      createCorporateChangeRequestSchema.safeParse({
        ...base,
        transfereeShareholdingId: "f7337fb9-0166-4166-8166-000000000003",
        transfereeNewShareholderName: "   ",
      }).success,
    ).toBe(true);
  });
});
