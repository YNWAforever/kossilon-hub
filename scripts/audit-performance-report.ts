import { z } from "zod";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const identifier = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const utc = z.string().datetime();
const count = z.number().int().nonnegative().safe();
const timing = z.number().finite().nonnegative();
const layerKeys = [
  "httpMs",
  "dbRttMs",
  "sqlMs",
  "serializationMs",
  "renderMs",
  "providerMs",
] as const;
const schema = z
  .object({
    formatVersion: z.literal(1),
    environment: z
      .object({
        level: z.enum([
          "LOCAL_CONTRACT",
          "LOCAL_REAL_DB",
          "CI_DEMO",
          "STAGING_OBSERVATION",
          "PRODUCTION_OBSERVATION",
        ]),
        targetId: identifier,
        buildSha: z.string().regex(/^[a-f0-9]{40}$/),
        platform: identifier,
        runtime: identifier,
        postgresMajor: count.positive(),
        webRegion: identifier,
        databaseRegion: identifier,
        poolSize: count.positive(),
        hardware: identifier,
      })
      .strict(),
    dataset: z
      .object({ cases: count, documents: count, versions: count, officers: count })
      .strict(),
    profile: z.object({ rampStartUtc: utc, steadyStartUtc: utc, endUtc: utc }).strict(),
    expectedEndpoints: z.array(identifier).min(1).max(50),
    expectedActors: z.array(identifier).min(1).max(100),
    samples: z
      .array(
        z
          .object({
            id: identifier,
            endpoint: identifier,
            actorId: identifier,
            phase: z.enum(["ramp", "steady"]),
            cache: z.enum(["cold", "warm", "unknown"]),
            startedAtUtc: utc,
            endedAtUtc: utc,
            outcome: z.enum(["success", "error"]),
            timings: z
              .object({
                httpMs: timing.optional(),
                dbRttMs: timing.optional(),
                sqlMs: timing.optional(),
                serializationMs: timing.optional(),
                renderMs: timing.optional(),
                providerMs: timing.optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(250_000),
  })
  .strict();

function invalid(): never {
  // Never include JSON values, filesystem errors or validation issue messages.
  throw new Error("Invalid performance measurement input.");
}

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (q: number) => (sorted.length ? sorted[Math.ceil(sorted.length * q) - 1] : null);
  return { p50: rank(0.5), p95: rank(0.95), p99: rank(0.99) };
}

function parseMeasurements(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) invalid();
  const data = parsed.data;
  const rampStart = Date.parse(data.profile.rampStartUtc);
  const steadyStart = Date.parse(data.profile.steadyStartUtc);
  const end = Date.parse(data.profile.endUtc);
  if (
    steadyStart <= rampStart ||
    end <= steadyStart ||
    steadyStart - rampStart > 3_600_000 ||
    end - steadyStart > 3_600_000
  )
    invalid();
  const actors = new Set(data.expectedActors);
  const endpoints = new Set(data.expectedEndpoints);
  if (
    actors.size !== data.expectedActors.length ||
    endpoints.size !== data.expectedEndpoints.length
  )
    invalid();
  const ids = new Set<string>();
  const samples = data.samples.map((sample) => {
    const started = Date.parse(sample.startedAtUtc);
    const ended = Date.parse(sample.endedAtUtc);
    if (
      ids.has(sample.id) ||
      !actors.has(sample.actorId) ||
      !endpoints.has(sample.endpoint) ||
      started < rampStart ||
      started >= end ||
      ended < started ||
      ended > end ||
      (started < steadyStart ? "ramp" : "steady") !== sample.phase
    )
      invalid();
    ids.add(sample.id);
    return { ...sample, started, elapsedMs: ended - started };
  });
  return { data, samples, rampStart, steadyStart, end, actors, endpoints };
}

/** Offline aggregation only. All metadata/classifications are caller assertions. */
export function buildAuditPerformanceReport(input: unknown) {
  const { data, samples, rampStart, steadyStart, end, actors, endpoints } =
    parseMeasurements(input);
  const blockers: string[] = [];
  if (steadyStart - rampStart < 300_000) blockers.push("ramp-duration-below-300s");
  if (end - steadyStart < 900_000) blockers.push("steady-duration-below-900s");
  if (actors.size !== 25) blockers.push("25-actors-required");
  if (data.dataset.cases < 10_000 || data.dataset.documents < 50_000)
    blockers.push("dataset-below-10k-cases-50k-documents");
  if (!data.dataset.versions || !data.dataset.officers)
    blockers.push("representative-versions-officers-missing");
  if (data.environment.postgresMajor !== 18) blockers.push("postgres-18-required");

  // A minute with 25 distinct request actors is coverage, never concurrency proof.
  const coverage: {
    phase: "ramp" | "steady";
    endpoint: string;
    minute: number;
    requiredActors: number;
    observedActors: number;
  }[] = [];
  for (const phase of ["ramp", "steady"] as const) {
    const phaseStart = phase === "ramp" ? rampStart : steadyStart;
    const phaseEnd = phase === "ramp" ? steadyStart : end;
    const minutes = Math.ceil((phaseEnd - phaseStart) / 60_000);
    for (const endpoint of [...endpoints].sort()) {
      const bins = Array.from({ length: minutes }, () => new Set<string>());
      for (const sample of samples) {
        if (sample.phase === phase && sample.endpoint === endpoint)
          bins[Math.floor((sample.started - phaseStart) / 60_000)].add(sample.actorId);
      }
      for (let minute = 0; minute < minutes; minute++) {
        const requiredActors = phase === "steady" ? 25 : Math.ceil((25 * (minute + 1)) / minutes);
        coverage.push({
          phase,
          endpoint,
          minute: minute + 1,
          requiredActors,
          observedActors: bins[minute].size,
        });
        if (bins[minute].size < requiredActors)
          blockers.push(`${phase}:${endpoint}:minute-${minute + 1}:actor-coverage`);
      }
    }
  }

  const grouped = new Map<string, typeof samples>();
  for (const sample of samples) {
    const key = `${sample.endpoint}:${sample.phase}:${sample.cache}`;
    const group = grouped.get(key) ?? [];
    group.push(sample);
    grouped.set(key, group);
  }
  const groups = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const successes = group.filter((s) => s.outcome === "success");
      const timings = Object.fromEntries(
        layerKeys.map((key) => {
          const values = group.flatMap((s) =>
            s.timings?.[key] === undefined ? [] : [s.timings[key]!],
          );
          return [key, { samples: values.length, ...percentiles(values) }];
        }),
      );
      return {
        endpoint: group[0].endpoint,
        phase: group[0].phase,
        cache: group[0].cache,
        attempts: group.length,
        successes: successes.length,
        errors: group.length - successes.length,
        errorRate: (group.length - successes.length) / group.length,
        elapsedMs: percentiles(group.map((s) => s.elapsedMs)),
        successfulElapsedMs: percentiles(successes.map((s) => s.elapsedMs)),
        timings,
      };
    });
  for (const endpoint of [...endpoints].sort()) {
    for (const cache of ["cold", "warm"] as const) {
      if (!samples.some((s) => s.endpoint === endpoint && s.cache === cache))
        blockers.push(`${endpoint}:${cache}-samples-missing`);
    }
  }
  return {
    formatVersion: 1,
    taskId: "R10",
    caseId: "UC24",
    environment: data.environment,
    dataset: data.dataset,
    profile: data.profile,
    expectedActors: [...actors],
    expectedEndpoints: [...endpoints],
    profileCompleteness: blockers.length ? "incomplete" : "complete",
    blockers,
    coverage,
    groups,
    releaseDecision: "NO_GO",
    sloAssessment: "not_assessed",
    limitations: [
      "actor_coverage_is_not_concurrency",
      "cache_labels_are_not_cold_state_proof",
      "metadata_is_not_provider_or_approval_receipt",
      "slo_not_adopted_or_evaluated",
      "no_business_or_release_acceptance",
    ],
  };
}

/** Derived observations only; preserve the original input and its JSON report. */
export function buildAuditPerformanceSamplesCsv(input: unknown): string {
  const { data, samples } = parseMeasurements(input);
  const cell = (value: string | number | undefined) => {
    const text = value === undefined ? "" : String(value);
    const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const header = [
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
  ];
  const rows = samples.map((sample) => [
    data.formatVersion,
    data.environment.buildSha,
    data.environment.level,
    data.environment.targetId,
    sample.id,
    sample.endpoint,
    sample.actorId,
    sample.phase,
    sample.cache,
    sample.startedAtUtc,
    sample.endedAtUtc,
    sample.elapsedMs,
    sample.outcome,
    ...layerKeys.map((key) => sample.timings?.[key]),
    "NO_GO",
    "not_assessed",
  ]);
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

function readBoundedJson(path: string): unknown {
  const fd = openSync(path, "r");
  try {
    const limit = 32 * 1024 * 1024;
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) invalid();
    const chunk = Buffer.alloc(64 * 1024);
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const bytes = readSync(fd, chunk, 0, chunk.length, null);
      if (!bytes) break;
      total += bytes;
      if (total > limit) invalid();
      chunks.push(Buffer.from(chunk.subarray(0, bytes)));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const csv = process.argv.length === 4 && process.argv[3] === "--samples-csv";
    if (process.argv.length !== 3 && !csv) invalid();
    const input = readBoundedJson(process.argv[2]);
    const report = buildAuditPerformanceReport(input);
    const output = csv
      ? buildAuditPerformanceSamplesCsv(input)
      : JSON.stringify(report, null, 2) + "\n";
    process.stdout.write(output);
    process.exitCode = report.profileCompleteness === "complete" ? 0 : 1;
  } catch {
    process.stderr.write("Invalid performance measurement input.\n");
    process.exitCode = 2;
  }
}
