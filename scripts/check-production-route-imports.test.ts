import { describe, expect, it } from "vitest";
import { scanProductionRoutes } from "./check-production-route-imports";

describe("scanProductionRoutes", () => {
  it("reports a forbidden browser mutation with its route", async () => {
    const result = await scanProductionRoutes({
      routeFiles: ["payments.tsx"],
      readRoute: async () => "acceptPaymentProof(caseId)",
    });

    expect(result.failures).toEqual([
      { file: "payments.tsx", pattern: "acceptPaymentProof(" },
    ]);
  });
});
