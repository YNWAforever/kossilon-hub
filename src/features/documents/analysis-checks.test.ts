import { describe, expect, it } from "vitest";
import {
  crossCheckFindings,
  readabilityFindings,
  sniffContentType,
  type CrossCheckSubject,
  type StoredBytesSample,
} from "./analysis-checks";
import type { Finding } from "./findings";
import type { DocumentVersionState } from "./versions";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function version(overrides: Partial<DocumentVersionState> = {}): DocumentVersionState {
  return {
    id: "ver-1",
    documentId: "doc-1",
    versionNumber: 1,
    declaredChecksum: HASH_A,
    verifiedChecksum: HASH_A,
    supersededByVersionId: null,
    ...overrides,
  };
}

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function sample(overrides: Partial<StoredBytesSample> = {}): StoredBytesSample {
  return {
    declaredContentType: "application/pdf",
    byteSize: 1024,
    head: bytesOf("%PDF-1.7\n"),
    tail: bytesOf("trailer\n<< /Size 10 >>\nstartxref\n1234\n%%EOF\n"),
    ...overrides,
  };
}

function byKey(findings: Finding[], ruleKey: string): Finding | undefined {
  return findings.find((finding) => finding.ruleKey === ruleKey);
}

describe("sniffContentType", () => {
  it("recognises the three formats uploads are restricted to", () => {
    expect(sniffContentType(bytesOf("%PDF-1.4"))).toBe("application/pdf");
    expect(
      sniffContentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    expect(sniffContentType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  it("returns null rather than guessing", () => {
    expect(sniffContentType(bytesOf("just some text"))).toBeNull();
    expect(sniffContentType(new Uint8Array())).toBeNull();
  });
});

describe("readabilityFindings", () => {
  it("passes a well-formed PDF that matches its declared type", () => {
    const findings = readabilityFindings(version(), sample());
    expect(byKey(findings, "content-type-matches-declared")?.outcome).toBe("pass");
    expect(byKey(findings, "pdf-complete")).toBeUndefined();
  });

  it("reports an empty file once, not as a cascade of symptoms", () => {
    const findings = readabilityFindings(
      version(),
      sample({ byteSize: 0, head: new Uint8Array(), tail: new Uint8Array() }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleKey: "file-empty", severity: "critical" });
  });

  // The file will not open. The client has to be asked again either way, and a
  // reviewer should not spend a slot discovering that.
  it("reports a truncated PDF as critical", () => {
    const findings = readabilityFindings(
      version(),
      sample({ tail: bytesOf("trailer\n<< /Size 10 >>\nstartxref\n1234\n") }),
    );
    expect(byKey(findings, "pdf-complete")).toMatchObject({
      outcome: "issue",
      severity: "critical",
    });
  });

  it("reports an encrypted PDF without trying to open it", () => {
    const findings = readabilityFindings(
      version(),
      sample({ tail: bytesOf("trailer\n<< /Encrypt 9 0 R /Size 10 >>\nstartxref\n1\n%%EOF\n") }),
    );
    expect(byKey(findings, "pdf-openable")).toMatchObject({
      outcome: "issue",
      severity: "warning",
    });
  });

  it("catches an image uploaded under a PDF content type", () => {
    const findings = readabilityFindings(
      version(),
      sample({ declaredContentType: "application/pdf", head: Uint8Array.from([0xff, 0xd8, 0xff]) }),
    );
    expect(byKey(findings, "content-type-matches-declared")).toMatchObject({
      outcome: "issue",
      detail: expect.stringContaining("image/jpeg"),
    });
  });

  // Unrecognised is not the same as wrong.
  it("is uncertain rather than accusatory about an unrecognised format", () => {
    const findings = readabilityFindings(version(), sample({ head: bytesOf("hello there") }));
    expect(byKey(findings, "content-type-recognised")?.outcome).toBe("uncertain");
  });

  it("does not run PDF structure checks against an image", () => {
    const findings = readabilityFindings(
      version(),
      sample({
        declaredContentType: "image/png",
        head: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        tail: bytesOf("no eof marker here"),
      }),
    );
    expect(byKey(findings, "pdf-complete")).toBeUndefined();
  });

  it("never invents a page number", () => {
    for (const finding of readabilityFindings(version(), sample())) {
      expect(finding.citation).toMatchObject({ pageFrom: null, pageTo: null });
    }
  });
});

function subject(overrides: Partial<CrossCheckSubject> = {}): CrossCheckSubject {
  return {
    version: version(),
    knownPageCount: null,
    declaredByteSize: 1024,
    verifiedByteSize: 1024,
    pageClaims: [],
    ...overrides,
  };
}

describe("crossCheckFindings", () => {
  // The most valuable check available today: the bytes in storage are not the
  // bytes the client said they were sending.
  it("reports a stored file that does not match its declared checksum as critical", () => {
    const findings = crossCheckFindings(
      subject({ version: version({ declaredChecksum: HASH_A, verifiedChecksum: HASH_B }) }),
    );
    expect(byKey(findings, "content-identity-matches-claim")).toMatchObject({
      outcome: "issue",
      severity: "critical",
    });
  });

  // Every document is in this state today, because the only code that hashes
  // stored bytes is the blocked provider scanner. Calling it an issue would
  // bury the real ones.
  it("is uncertain, not accusatory, when nobody has hashed the bytes", () => {
    const findings = crossCheckFindings(subject({ version: version({ verifiedChecksum: null }) }));
    expect(byKey(findings, "content-identity-known")).toMatchObject({
      outcome: "uncertain",
      severity: "warning",
    });
    expect(byKey(findings, "content-identity-matches-claim")).toBeUndefined();
  });

  it("passes when the stored bytes hash to what was declared", () => {
    expect(byKey(crossCheckFindings(subject()), "content-identity-matches-claim")?.outcome).toBe(
      "pass",
    );
  });

  it("reports a size that disagrees with the claim", () => {
    const findings = crossCheckFindings(subject({ verifiedByteSize: 2048 }));
    expect(byKey(findings, "byte-size-matches-claim")).toMatchObject({ outcome: "issue" });
  });

  it("says nothing about size when one side is unknown", () => {
    expect(
      byKey(crossCheckFindings(subject({ verifiedByteSize: null })), "byte-size-matches-claim"),
    ).toBeUndefined();
  });

  // The rule the reconnaissance showed is the only page check available: an
  // evidence link that cites pages the document does not have.
  it("reports evidence citing a page beyond the document", () => {
    const findings = crossCheckFindings(
      subject({
        knownPageCount: 2,
        pageClaims: [{ requirementInstanceId: "req-1", pageFrom: 3, pageTo: 4 }],
      }),
    );
    expect(byKey(findings, "cited-pages-exist")).toMatchObject({
      outcome: "issue",
      severity: "critical",
      citation: { kind: "version", pageFrom: 3, pageTo: 4 },
    });
  });

  it("accepts a page range inside the document", () => {
    const findings = crossCheckFindings(
      subject({
        knownPageCount: 5,
        pageClaims: [{ requirementInstanceId: "req-1", pageFrom: 1, pageTo: 2 }],
      }),
    );
    expect(byKey(findings, "cited-pages-exist")).toBeUndefined();
  });

  // Uncertain, never pass. A `pass` would assert that a page range was checked
  // when no page count exists -- and none does, because counting pages needs a
  // PDF parser that this runtime does not have.
  it("cannot check a page range with no page count, and says so", () => {
    const findings = crossCheckFindings(
      subject({
        knownPageCount: null,
        pageClaims: [{ requirementInstanceId: "req-1", pageFrom: 1, pageTo: 2 }],
      }),
    );
    expect(byKey(findings, "cited-pages-exist")).toMatchObject({ outcome: "uncertain" });
  });

  it("ignores a whole-document evidence link, which claims no pages at all", () => {
    const findings = crossCheckFindings(
      subject({
        knownPageCount: 1,
        pageClaims: [{ requirementInstanceId: "req-1", pageFrom: null, pageTo: null }],
      }),
    );
    expect(byKey(findings, "cited-pages-exist")).toBeUndefined();
  });
});
