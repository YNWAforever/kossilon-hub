import { describe, expect, it } from "vitest";
import { scanProductionRoutes } from "./check-production-route-imports";

describe("scanProductionRoutes", () => {
  it("reports an aliased forbidden store import with its route", async () => {
    const result = await scanProductionRoutes({
      routeFiles: ["payments.tsx"],
      readRoute: async () =>
        'import { acceptPaymentProof as accept } from "../lib/client-portal-store";',
    });

    expect(result.failures).toEqual([{ file: "payments.tsx", pattern: "acceptPaymentProof(" }]);
  });

  it("rejects namespace and dynamic protected-store imports", async () => {
    const result = await scanProductionRoutes({
      routeFiles: ["portal.tsx"],
      readRoute: async () =>
        [
          'import * as portalStore from "../lib/client-portal-store";',
          'const annualReturns = import("../lib/annual-return-store");',
        ].join("\n"),
    });

    expect(result.failures).toEqual([
      { file: "portal.tsx", pattern: "namespace import from client-portal-store" },
      { file: "portal.tsx", pattern: "dynamic import from annual-return-store" },
    ]);
  });
});
