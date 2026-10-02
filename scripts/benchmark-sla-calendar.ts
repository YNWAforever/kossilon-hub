import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus, platform, totalmem } from "node:os";
import { snapshotSla } from "../src/features/work-items/sla";
import type { BusinessCalendar } from "../src/features/work-items/types";

// Pure synthetic CPU measurement. No database, provider, clock or secret input.
const calendar: BusinessCalendar = {
  id: "synthetic-weekend-sla",
  timezone: "Asia/Hong_Kong",
  weeklySchedule: {
    monday: [{ start: "09:00", end: "18:00" }],
    tuesday: [{ start: "09:00", end: "18:00" }],
    wednesday: [{ start: "09:00", end: "18:00" }],
    thursday: [{ start: "09:00", end: "18:00" }],
    friday: [{ start: "09:00", end: "18:00" }],
    saturday: [],
    sunday: [],
  },
  holidays: [],
};
const startedAt = "2026-10-03T04:00:00.000Z";
const policies = Array.from({ length: 100 }, (_, index) => ({
  id: `synthetic-weekend-policy-${index}`,
  warningMinutes: 60,
  dueMinutes: 180,
}));
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const observedAt = new Date().toISOString();
const started = performance.now();
const results = policies.map((policy) => snapshotSla(policy, startedAt, calendar));
const milliseconds = performance.now() - started;
for (const [index, result] of results.entries()) {
  if (
    result.policyVersionId !== `synthetic-weekend-policy-${index}` ||
    result.startedAt !== startedAt ||
    result.warningAt !== "2026-10-05T02:00:00.000Z" ||
    result.dueAt !== "2026-10-05T04:00:00.000Z"
  ) {
    throw new Error(`Synthetic SLA snapshot ${index} differs from hand-checked timestamps.`);
  }
}
console.log(
  JSON.stringify(
    {
      observedAt,
      build: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      calendarSourceSha256: digest(
        readFileSync(new URL("../src/features/work-items/business-calendar.ts", import.meta.url)),
      ),
      inputSha256: digest(JSON.stringify({ calendar, startedAt, policies })),
      outputSha256: digest(JSON.stringify(results)),
      node: process.version,
      platform: platform(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      physicalMemoryBytes: totalmem(),
      iterations: results.length,
      milliseconds,
      exactTimestamps: "pass",
      scope: "One fixed synthetic workload on this host; no product/runtime SLO acceptance.",
    },
    null,
    2,
  ),
);
