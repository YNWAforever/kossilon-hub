import { describe, expect, it, vi } from "vitest";
import { auditDocumentLineage } from "./audit-document-lineage";

const base = {
  document_id: "doc",
  company_id: "company",
  case_id: "case",
  current_version_id: "version",
  intent_id: "intent",
  object_key: "private/key",
  intent_matches: true,
  upload_status: "available",
  scan_verdict_source: "provider",
  checksum_sha256: "a".repeat(64),
  verified_checksum_sha256: "a".repeat(64),
  expected_size_bytes: 4,
  content_type: "application/pdf",
};
const fakeSql = (rows: unknown[]) =>
  vi.fn(async (parts: TemplateStringsArray) =>
    parts.join("").includes("count(*)") ? [{ total: rows.length }] : rows,
  );

describe("read-only document lineage inventory", () => {
  it("keeps storage unknown without access and never mistakes business approval for clean evidence", async () => {
    const sql = fakeSql([
      { ...base, current_version_id: null, intent_id: null, intent_matches: false },
    ]);
    const result = await auditDocumentLineage(
      sql as unknown as Parameters<typeof auditDocumentLineage>[0],
    );
    expect(result.entries[0]).toMatchObject({
      availability: "metadata_only",
      objectState: "not_checked",
      verifiedEvidence: false,
    });
    expect(sql.mock.calls.every(([parts]) => parts.join("").trim().startsWith("select"))).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain("private/key");
    expect(result.mutationsPerformed).toBe(false);
  });
  it("separates missing, unsafe, unscanned, clean and unavailable probes without reading bytes", async () => {
    const rows = [
      { ...base, document_id: "missing" },
      { ...base, document_id: "unsafe", upload_status: "rejected" },
      { ...base, document_id: "unknown", scan_verdict_source: "deterministic" },
      { ...base, document_id: "clean" },
      { ...base, document_id: "denied", object_key: "denied" },
    ];
    let call = 0;
    const probe = vi.fn(async () => {
      call++;
      if (call === 1) return { state: "missing" as const };
      if (call === 5) throw new Error("private provider failure");
      return {
        state: "present" as const,
        checksum: base.checksum_sha256,
        sizeBytes: 4,
        contentType: base.content_type,
      };
    });
    const result = await auditDocumentLineage(
      fakeSql(rows) as unknown as Parameters<typeof auditDocumentLineage>[0],
      { probeObject: probe },
    );
    expect(result.entries.map((row) => row.availability)).toEqual([
      "missing_object",
      "unsafe",
      "unscanned",
      "available",
      "unscanned",
    ]);
    expect(result.entries.map((row) => row.verifiedEvidence)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(result.entries[4].objectState).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("private provider failure");
  });
  it("does not use a superseded or mismatched intent and reports bounded truncation", async () => {
    const sql = vi.fn(async (parts: TemplateStringsArray) =>
      parts.join("").includes("count(*)") ? [{ total: 501 }] : [{ ...base, intent_matches: false }],
    );
    const result = await auditDocumentLineage(
      sql as unknown as Parameters<typeof auditDocumentLineage>[0],
    );
    expect(result.truncated).toBe(true);
    expect(result.entries[0].availability).toBe("metadata_only");
    expect(result.entries[0].verifiedEvidence).toBe(false);
  });
});
