import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAuditCsv, verifyAuditUatLedger, type UatBaseline } from "./audit-uat-ledger";
const baseline: UatBaseline = JSON.parse(
  readFileSync("docs/audit-remediation/uat-original-2026-10-01.json", "utf8"),
);
const ledger = readFileSync("docs/audit-remediation/uat-results.csv", "utf8");
describe("original50 release evidence contract", () => {
  it("retains all original acceptance columns and refuses to call local contracts runtime acceptance", () => {
    const result = verifyAuditUatLedger(ledger, baseline);
    expect(result.original).toBe(50);
    expect(result.runtimeReleaseReady).toBe(false);
    expect(result.counts.pass + result.counts.blocked + result.counts.not_run).toBe(50);
  });
  it("refuses edited original acceptance, duplicate IDs and missing rows", () => {
    expect(() =>
      verifyAuditUatLedger(
        ledger.replace('"身份明確、可進入授權頁"', '"Different acceptance"'),
        baseline,
      ),
    ).toThrow(/original/);
    const lines = ledger.trimEnd().split("\n");
    expect(() => verifyAuditUatLedger(lines.slice(0, -1).join("\n"), baseline)).toThrow(/50/);
    expect(() =>
      verifyAuditUatLedger([...lines.slice(0, -1), lines[1]].join("\n"), baseline),
    ).toThrow(/original|duplicate/);
  });
  it("requires actual commands, build, environment, evidence and an owner for blocked cases", () => {
    const rows = parseAuditCsv(ledger);
    const owner = rows[0].indexOf("Blocker及Owner");
    rows[1][owner] = "";
    const csv = rows
      .map((r) => r.map((s) => '"' + s.replaceAll('"', '""') + '"').join(","))
      .join("\n");
    expect(() => verifyAuditUatLedger(csv, baseline)).toThrow(/owner/);
  });
  it("parses escaped quotes, commas and multiline evidence but refuses malformed quotes", () => {
    expect(parseAuditCsv('"id","note"\r\n"A","one, ""quote""\ntwo"\r\n')).toEqual([
      ["id", "note"],
      ["A", 'one, "quote"\ntwo'],
    ]);
    expect(() => parseAuditCsv('"unclosed')).toThrow(/quote/);
  });
});
