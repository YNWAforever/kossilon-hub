import { it, expect } from "vitest";
import { bulkPollInterval, bulkResourceHref } from "./job-view";
it("polls only visible active jobs, backs off failures and uses resource-specific safe entrances", () => {
  expect(bulkPollInterval(true, "running", 0)).toBe(5000);
  expect(bulkPollInterval(true, "queued", 2)).toBe(20000);
  expect(bulkPollInterval(false, "running", 0)).toBe(false);
  expect(bulkPollInterval(true, "completed", 0)).toBe(false);
  expect(bulkPollInterval(true, "partial", 0)).toBe(false);
  expect(bulkResourceHref("document", "doc")).toBe("/documents?documentId=doc");
});
