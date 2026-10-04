import { describe, expect, it } from "vitest";
import { buildAuditPerformanceReport } from "./audit-performance-report";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Sample = {
  id: string;
  endpoint: string;
  actorId: string;
  phase: "ramp" | "steady";
  cache: "cold" | "warm" | "unknown";
  startedAtUtc: string;
  endedAtUtc: string;
  outcome: "success" | "error";
  timings?: { sqlMs?: number; httpMs?: number };
};
const start = Date.parse("2026-10-04T06:00:00.000Z");
const at = (ms: number) => new Date(start + ms).toISOString();
function fixture() {
  const samples: Sample[] = [];
  for (const phase of ["ramp", "steady"] as const) {
    const minutes = phase === "ramp" ? 5 : 15;
    for (let minute = 0; minute < minutes; minute++) {
      const users = phase === "ramp" ? (minute + 1) * 5 : 25;
      for (let actor = 1; actor <= users; actor++) {
        for (const endpoint of ["today", "documents"]) {
          const offset = (phase === "steady" ? 300_000 : 0) + minute * 60_000 + actor * 100;
          samples.push({
            id: `${phase}-${minute}-${actor}-${endpoint}`,
            endpoint,
            actorId: `actor-${actor}`,
            phase,
            cache: phase === "ramp" && minute === 0 ? "cold" : "warm",
            startedAtUtc: at(offset),
            endedAtUtc: at(offset + 200),
            outcome: "success",
          });
        }
      }
    }
  }
  return {
    formatVersion: 1,
    environment: {
      level: "LOCAL_CONTRACT",
      targetId: "synthetic-test",
      buildSha: "a".repeat(40),
      platform: "synthetic",
      runtime: "node24.18.0",
      postgresMajor: 18,
      webRegion: "synthetic",
      databaseRegion: "synthetic",
      poolSize: 25,
      hardware: "synthetic",
    },
    dataset: { cases: 10_000, documents: 50_000, versions: 50_000, officers: 10_000 },
    profile: { rampStartUtc: at(0), steadyStartUtc: at(300_000), endUtc: at(1_200_000) },
    expectedEndpoints: ["today", "documents"],
    expectedActors: Array.from({ length: 25 }, (_, i) => `actor-${i + 1}`),
    samples,
  };
}

describe("offline R10 measurements", () => {
  it("keeps a structurally complete synthetic profile LOCAL and NO_GO", () => {
    const report = buildAuditPerformanceReport(fixture());
    expect(report.profileCompleteness).toBe("complete");
    expect(report.blockers).toEqual([]);
    expect(report.environment.buildSha).toBe("a".repeat(40));
    expect(report.environment.level).toBe("LOCAL_CONTRACT");
    expect(report.releaseDecision).toBe("NO_GO");
    expect(report.sloAssessment).toBe("not_assessed");
    expect(report.limitations).toContain("actor_coverage_is_not_concurrency");
    expect(report.limitations).toContain("cache_labels_are_not_cold_state_proof");
  });

  it("counts errors and calculates independent nearest-rank percentiles per phase/cache/endpoint", () => {
    const input = fixture();
    input.samples = [10, 20, 30, 40, 500].map((duration, i) => ({
      id: `sample-${i}`,
      endpoint: "today",
      actorId: `actor-${i + 1}`,
      phase: "steady",
      cache: "warm",
      startedAtUtc: at(300_000 + i * 1000),
      endedAtUtc: at(300_000 + i * 1000 + duration),
      outcome: i === 4 ? "error" : "success",
      ...(i < 2 ? { timings: { sqlMs: 2 + i * 2 } } : {}),
    }));
    input.samples.push({
      ...input.samples[0],
      id: "separate",
      endpoint: "documents",
      cache: "cold",
    });
    const report = buildAuditPerformanceReport(input);
    const group = report.groups.find((g) => g.endpoint === "today");
    expect(group).toMatchObject({
      phase: "steady",
      cache: "warm",
      attempts: 5,
      successes: 4,
      errors: 1,
      errorRate: 0.2,
      elapsedMs: { p50: 30, p95: 500, p99: 500 },
      successfulElapsedMs: { p50: 20, p95: 40, p99: 40 },
      timings: {
        sqlMs: { samples: 2, p50: 2, p95: 4, p99: 4 },
        httpMs: { samples: 0, p50: null, p95: null, p99: null },
      },
    });
    expect(report.groups).toHaveLength(2);
    expect(report.profileCompleteness).toBe("incomplete");
  });

  it("refuses to elevate one wave to the 20-minute profile even with 25 actors", () => {
    const input = fixture();
    input.samples = input.samples.filter((s) => Date.parse(s.startedAtUtc) < start + 360_000);
    const report = buildAuditPerformanceReport(input);
    expect(report.profileCompleteness).toBe("incomplete");
    expect(report.blockers).toContain("steady:today:minute-2:actor-coverage");
    expect(report.coverage.filter((row) => row.phase === "steady")).toHaveLength(30);
  });

  it("does not let a busy endpoint hide another endpoint's missing user", () => {
    const input = fixture();
    input.samples = input.samples.filter((s) => s.id !== "steady-7-25-documents");
    expect(buildAuditPerformanceReport(input).blockers).toContain(
      "steady:documents:minute-8:actor-coverage",
    );
  });

  it("does not fabricate zeros or cold classifications for absent samples", () => {
    const input = fixture();
    input.samples = [];
    const report = buildAuditPerformanceReport(input);
    expect(report.groups).toEqual([]);
    expect(report.blockers).toContain("today:cold-samples-missing");
    expect(report.blockers).toContain("today:warm-samples-missing");
  });

  it("records unknown cache samples separately and refuses a cold proof by first-sample assumption", () => {
    const input = fixture();
    input.samples.forEach((s) => {
      if (s.cache === "cold") s.cache = "unknown";
    });
    const report = buildAuditPerformanceReport(input);
    expect(report.blockers).toContain("documents:cold-samples-missing");
    expect(report.groups.some((g) => g.cache === "unknown")).toBe(true);
  });

  it.each([
    [
      "short-ramp",
      (input: ReturnType<typeof fixture>) => {
        input.profile.steadyStartUtc = at(299_000);
        input.samples = [];
      },
      "ramp-duration-below-300s",
    ],
    [
      "short-steady",
      (input: ReturnType<typeof fixture>) => {
        input.profile.endUtc = at(1_199_000);
        input.samples = [];
      },
      "steady-duration-below-900s",
    ],
    [
      "dataset",
      (input: ReturnType<typeof fixture>) => {
        input.dataset.documents = 49_999;
      },
      "dataset-below-10k-cases-50k-documents",
    ],
    [
      "representation",
      (input: ReturnType<typeof fixture>) => {
        input.dataset.versions = 0;
      },
      "representative-versions-officers-missing",
    ],
    [
      "PG17",
      (input: ReturnType<typeof fixture>) => {
        input.environment.postgresMajor = 17;
      },
      "postgres-18-required",
    ],
  ])("marks %s incomplete rather than granting SLO acceptance", (_name, mutate, blocker) => {
    const input = fixture();
    mutate(input);
    const report = buildAuditPerformanceReport(input);
    expect(report.blockers).toContain(blocker);
    expect(report.releaseDecision).toBe("NO_GO");
  });

  it.each([
    [
      "duplicate sample",
      (i: ReturnType<typeof fixture>) => {
        i.samples.push(i.samples[0]);
      },
    ],
    [
      "duplicate actor",
      (i: ReturnType<typeof fixture>) => {
        i.expectedActors.push(i.expectedActors[0]);
      },
    ],
    [
      "duplicate endpoint",
      (i: ReturnType<typeof fixture>) => {
        i.expectedEndpoints.push("today");
      },
    ],
    [
      "unreviewed actor",
      (i: ReturnType<typeof fixture>) => {
        i.samples[0].actorId = "other-actor";
      },
    ],
    [
      "unreviewed endpoint",
      (i: ReturnType<typeof fixture>) => {
        i.samples[0].endpoint = "other-endpoint";
      },
    ],
    [
      "phase contradiction",
      (i: ReturnType<typeof fixture>) => {
        i.samples[0].phase = "steady";
      },
    ],
    [
      "negative elapsed",
      (i: ReturnType<typeof fixture>) => {
        i.samples[0].endedAtUtc = at(0);
      },
    ],
    [
      "out-of-window",
      (i: ReturnType<typeof fixture>) => {
        i.samples[0].endedAtUtc = at(1_200_001);
      },
    ],
    [
      "negative layer",
      (i: ReturnType<typeof fixture>) => {
        i.samples[0].timings = { sqlMs: -1 };
      },
    ],
    [
      "non-finite layer",
      (i: ReturnType<typeof fixture>) => {
        i.samples[0].timings = { sqlMs: Infinity };
      },
    ],
    [
      "local timezone",
      (i: ReturnType<typeof fixture>) => {
        i.samples[0].startedAtUtc = "2026-10-04T14:00:00+08:00";
      },
    ],
    [
      "secret-shaped target",
      (i: ReturnType<typeof fixture>) => {
        i.environment.targetId = "postgres://secret@private";
      },
    ],
  ])("rejects %s without echoing input", (_name, mutate) => {
    const input = fixture();
    mutate(input);
    expect(() => buildAuditPerformanceReport(input)).toThrow(
      "Invalid performance measurement input.",
    );
  });

  it("rejects unknown input fields without reporting their secret contents", () => {
    expect(() => buildAuditPerformanceReport({ ...fixture(), password: "DO_NOT_ECHO" })).toThrow(
      "Invalid performance measurement input.",
    );
  });

  it("never treats an environment label as genuine acceptance", () => {
    const input = fixture();
    input.environment.level = "STAGING_OBSERVATION";
    const report = buildAuditPerformanceReport(input);
    expect(report.releaseDecision).toBe("NO_GO");
    expect(report.limitations).toContain("metadata_is_not_provider_or_approval_receipt");
  });

  it("reports actual CLI exits for complete/incomplete/invalid input without exposing values", () => {
    const directory = mkdtempSync(join(tmpdir(), "kossilon-r10-report-"));
    const path = join(directory, "input.json");
    const run = () =>
      spawnSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/audit-performance-report.ts", path],
        { encoding: "utf8", timeout: 10_000 },
      );
    try {
      writeFileSync(path, JSON.stringify(fixture()));
      const complete = run();
      expect(complete.status).toBe(0);
      expect(JSON.parse(complete.stdout)).toMatchObject({
        profileCompleteness: "complete",
        releaseDecision: "NO_GO",
      });
      const incomplete = fixture();
      incomplete.samples = [];
      writeFileSync(path, JSON.stringify(incomplete));
      const sparse = run();
      expect(sparse.status).toBe(1);
      expect(JSON.parse(sparse.stdout).profileCompleteness).toBe("incomplete");
      for (const content of [
        "DO_NOT_ECHO",
        JSON.stringify({ ...fixture(), token: "DO_NOT_ECHO" }),
      ]) {
        writeFileSync(path, content);
        const bad = run();
        expect(bad.status).toBe(2);
        expect(bad.stdout).toBe("");
        expect(bad.stderr).not.toContain("DO_NOT_ECHO");
        expect(bad.stderr).not.toContain(path);
      }
      truncateSync(path, 33 * 1024 * 1024);
      const oversized = run();
      expect(oversized.status).toBe(2);
      expect(oversized.stdout).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
