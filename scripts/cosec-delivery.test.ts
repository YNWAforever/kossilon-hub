import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyCosecDelivery, type DeliverySource } from "./cosec-delivery";

const sha = "1".repeat(40);
const csvOf = (rows: string[][]) =>
  rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function fixture() {
  const sources: DeliverySource[] = (
    [
      ["F", 35],
      ["R", 15],
      ["UC", 100],
      ["LA", 34],
    ] as const
  ).map(([recordType, count]) => {
    const rows = Array.from({ length: count }, (_, index) => [
      `${recordType}${recordType === "UC" ? index + 99 : index + 1}`,
      `原有 ${recordType} ${index + 1}`,
      index % 2 ? "fail" : "blocked",
    ]);
    const text = csvOf([["id", "title", "result"], ...rows]);
    return { recordType, fileName: `${recordType}.csv`, idColumn: "id", text, sha256: hash(text) };
  });
  const header = [
    "record_type",
    "id",
    "source_file",
    "original_row_json",
    "local_result",
    "local_scope",
    "evidence_paths",
    "native_result",
    "remaining_scope",
  ];
  const rows = sources.flatMap((source) => {
    const count = { F: 35, R: 15, UC: 100, LA: 34 }[source.recordType];
    return Array.from({ length: count }, (_, index) => {
      const id = `${source.recordType}${source.recordType === "UC" ? index + 99 : index + 1}`;
      return [
        source.recordType,
        id,
        source.fileName,
        JSON.stringify({
          id,
          title: `原有 ${source.recordType} ${index + 1}`,
          result: index % 2 ? "fail" : "blocked",
        }),
        "PARTIAL_LOCAL",
        "unit/component with mocked RPC only",
        "unit.txt",
        "BLOCKED",
        "Native Auth, HTTP, data readback and reload remain unverified.",
      ];
    });
  });
  const candidate = {
    run_id: "run-one",
    source_sha: sha,
    base_sha: "2".repeat(40),
    release_gate: "NO_GO",
    auth_runtime_verified: false,
  };
  return { sources, header, rows, candidate };
}

function verify(data = fixture()) {
  return verifyCosecDelivery({
    csv: csvOf([data.header, ...data.rows]),
    sources: data.sources,
    candidate: data.candidate,
    expectedSourceSha: sha,
    runId: "run-one",
    evidenceExists: (path) => path === "unit.txt",
  });
}

describe("2026-10-23 local delivery evidence boundary", () => {
  it("retains all 184 original records and grants no native release acceptance", () => {
    expect(verify()).toEqual({
      original: { F: 35, R: 15, UC: 100, LA: 34 },
      rows: 184,
      nativePasses: 0,
      releaseGate: "NO_GO",
    });
  });
  it("rejects lost, duplicate or substituted original IDs", () => {
    const lost = fixture();
    lost.rows.pop();
    expect(() => verify(lost)).toThrow(/184/);
    const duplicate = fixture();
    duplicate.rows[1] = duplicate.rows[0];
    expect(() => verify(duplicate)).toThrow(/duplicate/i);
    const substituted = fixture();
    substituted.rows[0][1] = "F999";
    expect(() => verify(substituted)).toThrow(/original/i);
  });
  it("rejects altered historical assertions even when the ID is unchanged", () => {
    const data = fixture();
    data.rows[0][3] = JSON.stringify({ id: "F1", title: "weakened", result: "pass" });
    expect(() => verify(data)).toThrow(/original/i);
  });
  it("rejects stale source inputs and wrong run or candidate SHA", () => {
    const stale = fixture();
    stale.sources[0].text += "\nchanged";
    expect(() => verify(stale)).toThrow(/checksum/i);
    const other = fixture();
    other.candidate.source_sha = "3".repeat(40);
    expect(() => verify(other)).toThrow(/SHA/);
    other.candidate.source_sha = sha;
    other.candidate.run_id = "another-run";
    expect(() => verify(other)).toThrow(/run/i);
  });
  it("refuses blocked-as-pass, release GO and native claims from a local-only run", () => {
    const data = fixture();
    data.rows[0][7] = "PASS";
    expect(() => verify(data)).toThrow(/native/i);
    const go = fixture();
    go.candidate.release_gate = "GO";
    expect(() => verify(go)).toThrow(/NO_GO/);
    const auth = fixture();
    auth.candidate.auth_runtime_verified = true;
    expect(() => verify(auth)).toThrow(/native/i);
  });
  it("requires scoped, existing local evidence and explicit remaining acceptance", () => {
    for (const index of [5, 6, 8]) {
      const data = fixture();
      data.rows[0][index] = "";
      expect(() => verify(data)).toThrow(/evidence|scope/i);
    }
    const missing = fixture();
    missing.rows[0][6] = "absent.txt";
    expect(() => verify(missing)).toThrow(/evidence/i);
  });
  it("rejects escaped evidence paths, malformed original JSON and duplicate columns", () => {
    for (const path of [
      "../elsewhere.txt",
      "C:/secret.txt",
      "https://example.com",
      "safe/../../x",
      "safe\\..\\x",
    ]) {
      const data = fixture();
      data.rows[0][6] = path;
      expect(() => verify(data)).toThrow(/path/i);
    }
    const bad = fixture();
    bad.rows[0][3] = "not JSON";
    expect(() => verify(bad)).toThrow(/original/i);
    const columns = fixture();
    columns.header[0] = columns.header[1];
    expect(() => verify(columns)).toThrow(/column/i);
  });
});
