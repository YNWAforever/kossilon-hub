import { expect, it } from "vitest";
import { observeCompanyWorkspace } from "./restored-company-evidence";
const reader = (partial: boolean) => ({
  summary: async () => ({ partial: false, openCases: 2, documents: 1, paymentCases: 3 }),
  cases: async () => ({ partial }),
  documents: async () => ({}),
  payments: async () => ({}),
  activity: async () => ({ items: [{}, {}] }),
});
it("refuses a later partial cases read even after a complete company summary", async () => {
  await expect(observeCompanyWorkspace(reader(true))).rejects.toThrow("company cases are partial");
});
it("records all tabs only after each actual reader succeeds", async () => {
  expect(await observeCompanyWorkspace(reader(false))).toEqual({
    observed: true,
    tabs: ["overview", "cases", "documents", "payments", "activity"],
    openCases: 2,
    documents: 1,
    paymentCases: 3,
    activityRows: 2,
  });
  const unavailable = {
    ...reader(false),
    documents: async () => {
      throw Error("document query unavailable");
    },
  };
  await expect(observeCompanyWorkspace(unavailable)).rejects.toThrow("document query unavailable");
});
