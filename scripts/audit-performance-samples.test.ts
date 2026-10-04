import { describe, expect, it } from "vitest";
import * as measurements from "./audit-performance-report";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exportCsv = (input: unknown): string =>
  (Reflect.get(measurements, "buildAuditPerformanceSamplesCsv") as (input: unknown) => string)(
    input,
  );
const at = (offset: number) => new Date(Date.parse("2026-10-04T08:00:00Z") + offset).toISOString();
function fixture() {
  return {
    formatVersion: 1,
    environment: {
      level: "LOCAL_CONTRACT",
      targetId: "owned-local",
      buildSha: "b".repeat(40),
      platform: "synthetic",
      runtime: "node24",
      postgresMajor: 18,
      webRegion: "local",
      databaseRegion: "local",
      poolSize: 25,
      hardware: "synthetic",
    },
    dataset: { cases: 10_000, documents: 50_000, versions: 50_000, officers: 10_000 },
    profile: { rampStartUtc: at(0), steadyStartUtc: at(300_000), endUtc: at(1_200_000) },
    expectedEndpoints: ["today"],
    expectedActors: ["actor-1"],
    samples: [
      {
        id: "failed-first",
        endpoint: "today",
        actorId: "actor-1",
        phase: "ramp",
        cache: "unknown",
        startedAtUtc: at(1000),
        endedAtUtc: at(1250),
        outcome: "error",
        timings: {
          httpMs: 0,
          dbRttMs: 1.5,
          sqlMs: 2,
          serializationMs: 3,
          renderMs: 4,
          providerMs: 5,
        },
      },
      {
        id: "successful-second",
        endpoint: "today",
        actorId: "actor-1",
        phase: "steady",
        cache: "warm",
        startedAtUtc: at(300_001),
        endedAtUtc: at(300_011),
        outcome: "success",
        timings: {},
      },
    ],
  };
}

// The input schema excludes commas/quotes/newlines in identifiers. Read the
// exporter contract's quoted cells independently of its implementation.
function rows(csv: string) {
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv
    .slice(0, -2)
    .split("\r\n")
    .map((row) => row.split(",").map((cell) => JSON.parse(cell)));
}

describe("R10 individual sample CSV", () => {
  it("exports errors and successes in source order with identity, measured layers and acceptance limits", () => {
    const table = rows(exportCsv(fixture()));
    expect(table[0]).toEqual([
      "format_version",
      "build_sha",
      "environment_level",
      "target_id",
      "sample_id",
      "endpoint",
      "actor_id",
      "phase",
      "cache",
      "started_at_utc",
      "ended_at_utc",
      "elapsed_ms",
      "outcome",
      "http_ms",
      "db_rtt_ms",
      "sql_ms",
      "serialization_ms",
      "render_ms",
      "provider_ms",
      "release_decision",
      "slo_assessment",
    ]);
    expect(table).toHaveLength(3);
    expect(table[1]).toEqual([
      "1",
      "b".repeat(40),
      "LOCAL_CONTRACT",
      "owned-local",
      "failed-first",
      "today",
      "actor-1",
      "ramp",
      "unknown",
      "2026-10-04T08:00:01.000Z",
      "2026-10-04T08:00:01.250Z",
      "250",
      "error",
      "0",
      "1.5",
      "2",
      "3",
      "4",
      "5",
      "NO_GO",
      "not_assessed",
    ]);
    expect(table[2]).toEqual([
      "1",
      "b".repeat(40),
      "LOCAL_CONTRACT",
      "owned-local",
      "successful-second",
      "today",
      "actor-1",
      "steady",
      "warm",
      "2026-10-04T08:05:00.001Z",
      "2026-10-04T08:05:00.011Z",
      "10",
      "success",
      "",
      "",
      "",
      "",
      "",
      "",
      "NO_GO",
      "not_assessed",
    ]);
  });

  it("leaves the original measurement object unchanged", () => {
    const input = fixture();
    const original = JSON.stringify(input);
    exportCsv(input);
    expect(JSON.stringify(input)).toBe(original);
  });

  it("retains only the header for no observations without inventing a success or zero timing", () => {
    const input = fixture();
    input.samples = [];
    expect(rows(exportCsv(input))).toHaveLength(1);
  });

  it("neutralises a leading minus in every identifier column while keeping numeric zero", () => {
    const input = fixture();
    input.environment.targetId = "-owned";
    input.expectedEndpoints = ["-today"];
    input.expectedActors = ["-actor"];
    input.samples = [{ ...input.samples[0], id: "-sample", endpoint: "-today", actorId: "-actor" }];
    const row = rows(exportCsv(input))[1];
    expect(row.slice(3, 7)).toEqual(["'-owned", "'-sample", "'-today", "'-actor"]);
    expect(row[13]).toBe("0");
  });

  it("does not elevate staging-labelled incomplete observations to genuine or SLO acceptance", () => {
    const input = fixture();
    input.environment.level = "STAGING_OBSERVATION";
    const row = rows(exportCsv(input))[1];
    expect(row[2]).toBe("STAGING_OBSERVATION");
    expect(row.slice(-2)).toEqual(["NO_GO", "not_assessed"]);
  });

  it.each([
    [
      "duplicate sample",
      (input: ReturnType<typeof fixture>) => ({
        ...input,
        samples: [input.samples[0], input.samples[0]],
      }),
    ],
    [
      "undeclared actor",
      (input: ReturnType<typeof fixture>) => ({ ...input, expectedActors: ["other"] }),
    ],
    [
      "out of window",
      (input: ReturnType<typeof fixture>) => ({
        ...input,
        samples: [{ ...input.samples[0], endedAtUtc: at(1_200_001) }],
      }),
    ],
    [
      "wrong phase",
      (input: ReturnType<typeof fixture>) => ({
        ...input,
        samples: [{ ...input.samples[0], phase: "steady" }],
      }),
    ],
    [
      "negative layer",
      (input: ReturnType<typeof fixture>) => ({
        ...input,
        samples: [{ ...input.samples[0], timings: { sqlMs: -1 } }],
      }),
    ],
    [
      "non-finite layer",
      (input: ReturnType<typeof fixture>) => ({
        ...input,
        samples: [{ ...input.samples[0], timings: { sqlMs: Infinity } }],
      }),
    ],
    ["unknown field", (input: ReturnType<typeof fixture>) => ({ ...input, token: "DO_NOT_ECHO" })],
    [
      "formula payload",
      (input: ReturnType<typeof fixture>) => ({
        ...input,
        environment: { ...input.environment, targetId: "=HYPERLINK_DO_NOT_ECHO" },
      }),
    ],
  ] as const)(
    "rejects %s through the same strict contract without exposing raw data",
    (_name, change) => {
      expect(() => exportCsv(change(fixture()))).toThrow("Invalid performance measurement input.");
    },
  );

  it("runs the real CSV flag with complete/incomplete exits while preserving the default JSON mode", () => {
    const directory = mkdtempSync(join(tmpdir(), "kossilon-r10-csv-"));
    const path = join(directory, "samples.json");
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/audit-performance-report.ts", path, ...args],
        { encoding: "utf8", timeout: 10_000 },
      );
    try {
      writeFileSync(path, JSON.stringify(fixture()));
      const sparse = run("--samples-csv");
      expect(sparse.status).toBe(1);
      expect(rows(sparse.stdout)).toHaveLength(3);
      const json = run();
      expect(json.status).toBe(1);
      expect(JSON.parse(json.stdout)).toMatchObject({
        profileCompleteness: "incomplete",
        releaseDecision: "NO_GO",
      });

      const complete = fixture();
      complete.expectedActors = Array.from({ length: 25 }, (_, i) => `actor-${i + 1}`);
      complete.samples = [];
      for (let minute = 0; minute < 20; minute++) {
        const count = minute < 5 ? (minute + 1) * 5 : 25;
        for (let actor = 1; actor <= count; actor++) {
          const offset = minute * 60_000 + actor * 1000;
          complete.samples.push({
            ...fixture().samples[1],
            id: `sample-${minute}-${actor}`,
            actorId: `actor-${actor}`,
            phase: minute < 5 ? "ramp" : "steady",
            cache: minute === 0 ? "cold" : "warm",
            startedAtUtc: at(offset),
            endedAtUtc: at(offset + 10),
          });
        }
      }
      writeFileSync(path, JSON.stringify(complete));
      const observed = run("--samples-csv");
      expect(observed.status).toBe(0);
      expect(rows(observed.stdout)).toHaveLength(451);
      expect(
        rows(observed.stdout)
          .slice(1)
          .every((row) => row[19] === "NO_GO"),
      ).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses malformed/oversized input and unknown flags before any CSV stdout", () => {
    const directory = mkdtempSync(join(tmpdir(), "kossilon-r10-csv-refusal-"));
    const path = join(directory, "DO_NOT_ECHO.json");
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/audit-performance-report.ts", path, ...args],
        { encoding: "utf8", timeout: 10_000 },
      );
    try {
      for (const invalid of [
        "DO_NOT_ECHO",
        JSON.stringify({ ...fixture(), password: "DO_NOT_ECHO" }),
      ]) {
        writeFileSync(path, invalid);
        const result = run("--samples-csv");
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).not.toContain("DO_NOT_ECHO");
      }
      writeFileSync(path, JSON.stringify(fixture()));
      for (const args of [["--csv"], ["--samples-csv", "extra"]]) {
        const result = run(...args);
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
      }
      truncateSync(path, 33 * 1024 * 1024);
      const oversized = run("--samples-csv");
      expect(oversized.status).toBe(2);
      expect(oversized.stdout).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
