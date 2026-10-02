import { makeFinding, type Finding, type FindingCitation } from "./findings";
import type { DocumentVersionState } from "./versions";
import type { ExtractedEvidence, EvidenceSpan } from "./text-extraction";

export type AnalysisFieldExpectation = {
  field: "party_name" | "return_year" | "document_date";
  expected: string | null;
  partyId: string | null;
  requirementInstanceId: string | null;
  applicability: "required" | "not_applicable" | "waived" | "unknown";
  authorised?: boolean;
  referenceDate?: string | null;
  maxAgeDays?: number | null;
};

/** Labelled text only; filenames and arbitrary mentions never establish a field. */
export function contentEvidenceFindings(
  evidence: ExtractedEvidence,
  expectations: readonly AnalysisFieldExpectation[],
): Finding[] {
  return expectations.flatMap((expectation) => {
    if (
      (expectation.applicability === "not_applicable" || expectation.applicability === "waived") &&
      expectation.authorised
    )
      return [];
    let unknown = evidence.unknownReason;
    if (expectation.applicability !== "required") unknown = "applicability-unconfirmed";
    else if (expectation.expected === null && expectation.field !== "document_date")
      unknown = "expected-value-unconfirmed";
    if (!evidence.pages.some((page) => page.text.trim())) unknown ??= "no-readable-text";
    const label =
      expectation.field === "party_name"
        ? "(?:Name|Company name|姓名|公司名稱)"
        : expectation.field === "return_year"
          ? "(?:Return year|申報年度|年度)"
          : "(?:Date|日期)";
    const expression = new RegExp(`(?:^|[;\\n])\\s*${label}\\s*[:：]\\s*([^;\\n]+)`, "giu");
    const matches: { observed: string; span: EvidenceSpan; lowConfidence: boolean }[] = [];
    for (const page of evidence.pages)
      for (const match of page.text.matchAll(expression)) {
        const observed = match[1].trim();
        const start = match.index! + match[0].lastIndexOf(match[1]) + match[1].indexOf(observed);
        matches.push({
          observed,
          span: { page: page.page, start, end: start + observed.length, quote: observed },
          lowConfidence:
            page.method === "ocr" && (page.confidence === null || page.confidence < 0.8),
        });
      }
    if (matches.length !== 1)
      unknown ??= matches.length ? "ambiguous-labelled-field" : "labelled-field-not-found";
    if (matches.some((match) => match.lowConfidence)) unknown ??= "low-confidence-text";
    const observed = unknown ? null : (matches[0]?.observed ?? null);
    let agrees =
      observed !== null &&
      observed.normalize("NFKC").toLocaleLowerCase() ===
        expectation.expected?.normalize("NFKC").toLocaleLowerCase();
    if (
      expectation.field === "return_year" &&
      observed !== null &&
      !/^(?:19|20|21)\d{2}$/.test(observed)
    )
      unknown = "year-not-readable";
    if (expectation.field === "document_date" && observed !== null) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(observed) ? Date.parse(observed + "T00:00:00Z") : NaN;
      const reference = expectation.referenceDate
        ? Date.parse(expectation.referenceDate + "T00:00:00Z")
        : NaN;
      if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== observed)
        unknown = "date-not-readable";
      else if (
        !Number.isFinite(reference) ||
        new Date(reference).toISOString().slice(0, 10) !== expectation.referenceDate ||
        !Number.isInteger(expectation.maxAgeDays) ||
        expectation.maxAgeDays! < 0
      )
        unknown = "date-rule-unconfirmed";
      else agrees = date <= reference && date >= reference - expectation.maxAgeDays! * 86_400_000;
    }
    const spans = unknown ? [] : matches.map((match) => match.span);
    const fieldLabel = {
      party_name: "姓名／公司名稱",
      return_year: "申報年度",
      document_date: "文件日期",
    }[expectation.field];
    const reasonLabel =
      unknown === "applicability-unconfirmed"
        ? "適用對象尚未確認"
        : unknown === "expected-value-unconfirmed"
          ? "預期資料尚未確認"
          : unknown === "ambiguous-labelled-field"
            ? "有多個欄位，未能確定所指對象"
            : unknown === "labelled-field-not-found"
              ? "未找到可核對的標示欄位"
              : unknown === "low-confidence-text"
                ? "文字辨識信心不足"
                : unknown === "date-rule-unconfirmed"
                  ? "日期規則尚未批准"
                  : unknown === "date-not-readable" || unknown === "year-not-readable"
                    ? "日期／年度未能讀取"
                    : "缺乏可核對的完整文字";
    return [
      makeFinding({
        ruleKey: `content:${expectation.field}:${expectation.requirementInstanceId ?? "case"}`,
        ruleVersion: "labelled-fields-1",
        tier: "cross-check",
        outcome: unknown ? "uncertain" : agrees ? "pass" : "issue",
        severity: unknown ? "info" : agrees ? "info" : "warning",
        detail: unknown
          ? `需要人工覆核${fieldLabel}：${reasonLabel}。`
          : agrees
            ? `${fieldLabel}與已確認資料一致。`
            : `${fieldLabel}：文件為「${observed}」，預期「${expectation.expected ?? expectation.referenceDate}」。需要人工核對。`,
        citation: {
          kind: "version",
          documentVersionId: evidence.documentVersionId,
          pageFrom: spans[0]?.page ?? null,
          pageTo: spans.at(-1)?.page ?? null,
        },
        evidence: {
          sha256: evidence.sha256,
          field: expectation.field,
          partyId: expectation.partyId,
          year:
            expectation.field === "return_year" &&
            expectation.expected &&
            /^(?:19|20|21)\d{2}$/.test(expectation.expected)
              ? Number(expectation.expected)
              : null,
          expected: expectation.expected,
          observed: unknown ? null : observed,
          unknownReason: unknown,
          requirementInstanceId: expectation.requirementInstanceId,
          spans,
        },
      }),
    ];
  });
}

/**
 * The two deterministic tiers, and only what they can honestly compute.
 *
 * Text extraction now exists (`text-extraction.ts`, run by the analysis pass on
 * scan-verified PDFs) and supplies the page count used below. It has not yet
 * run on a deployed Worker, and under the scanner blocker it reaches no
 * document, so BLOCKED_INTEGRATION: document-text-extraction stands until
 * /operations shows a real text-layer row. No rule here reads a document's
 * words; the two date rules are a separate design. What is here is still worth
 * having: whether the file will open at all, and whether the records about it
 * agree with each other.
 */

export const READABILITY_RULE_VERSION = "1";
export const CROSS_CHECK_RULE_VERSION = "1";

/**
 * Enough of the stored object to judge readability, without holding a 10 MB
 * buffer per job. The head carries every format's magic bytes; the tail carries
 * a PDF's trailer, which is where truncation shows up.
 */
export type StoredBytesSample = {
  declaredContentType: string | null;
  byteSize: number;
  head: Uint8Array;
  tail: Uint8Array;
};

export const BYTES_SAMPLE_WINDOW = 2048;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

/** What the bytes say they are, as opposed to what the upload claimed. */
export function sniffContentType(head: Uint8Array): string | null {
  if (startsWith(head, PDF_MAGIC)) return "application/pdf";
  if (startsWith(head, PNG_MAGIC)) return "image/png";
  if (startsWith(head, JPEG_MAGIC)) return "image/jpeg";
  return null;
}

function asLatin1(bytes: Uint8Array): string {
  // Latin-1, not UTF-8: a PDF trailer is structural ASCII embedded in binary,
  // and UTF-8 decoding would replace stray high bytes and shift the offsets of
  // the markers being searched for.
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function versionCitation(version: DocumentVersionState): FindingCitation {
  return {
    kind: "version",
    documentVersionId: version.id,
    // No page range: nothing here reads pages, and a page number invented to
    // look precise is exactly what the citation contract forbids.
    pageFrom: null,
    pageTo: null,
  };
}

/**
 * Tier 1: will a reviewer be able to open this at all?
 *
 * Worth running even with no text extraction. A reviewer who opens an encrypted
 * or truncated PDF has spent a review slot to learn nothing, and the client has
 * to be asked again either way -- sooner is strictly better.
 */
export function readabilityFindings(
  version: DocumentVersionState,
  bytes: StoredBytesSample,
): Finding[] {
  const findings: Finding[] = [];
  const citation = versionCitation(version);
  const base = { ruleVersion: READABILITY_RULE_VERSION, tier: "classification" as const, citation };

  if (bytes.byteSize === 0) {
    // Nothing else can be said about zero bytes, and every later check would
    // report a second symptom of this one cause.
    return [
      makeFinding({
        ...base,
        ruleKey: "file-empty",
        outcome: "issue",
        severity: "critical",
        detail: "The stored file is empty. There is nothing to review.",
      }),
    ];
  }

  const sniffed = sniffContentType(bytes.head);
  if (sniffed === null) {
    findings.push(
      makeFinding({
        ...base,
        ruleKey: "content-type-recognised",
        outcome: "uncertain",
        severity: "warning",
        detail:
          "The file does not begin with a PDF, PNG or JPEG signature, so its format could not be confirmed.",
      }),
    );
  } else if (bytes.declaredContentType && sniffed !== bytes.declaredContentType) {
    findings.push(
      makeFinding({
        ...base,
        ruleKey: "content-type-matches-declared",
        outcome: "issue",
        severity: "warning",
        detail: `The upload was declared as ${bytes.declaredContentType} but the bytes are ${sniffed}.`,
      }),
    );
  } else {
    findings.push(
      makeFinding({
        ...base,
        ruleKey: "content-type-matches-declared",
        outcome: "pass",
        severity: "info",
        detail: `The bytes are ${sniffed}, matching the declared type.`,
      }),
    );
  }

  if (sniffed === "application/pdf") {
    const trailer = asLatin1(bytes.tail);

    if (!trailer.includes("%%EOF")) {
      findings.push(
        makeFinding({
          ...base,
          ruleKey: "pdf-complete",
          outcome: "issue",
          severity: "critical",
          detail: "The PDF has no end-of-file marker, so the upload is truncated or corrupt.",
        }),
      );
    }

    // Presence of /Encrypt in the trailer, which is where the encryption
    // dictionary is referenced. This does not decrypt anything and does not
    // need to: a file that will ask a reviewer for a password is the finding.
    if (trailer.includes("/Encrypt")) {
      findings.push(
        makeFinding({
          ...base,
          ruleKey: "pdf-openable",
          outcome: "issue",
          severity: "warning",
          detail: "The PDF is encrypted and will ask for a password before it can be read.",
        }),
      );
    }
  }

  return findings;
}

export type EvidencePageClaim = {
  requirementInstanceId: string;
  pageFrom: number | null;
  pageTo: number | null;
};

export type CrossCheckSubject = {
  version: DocumentVersionState;
  /**
   * From `document_version_texts.page_count`. Null means nobody has counted --
   * which is every document today, because counting pages needs a real PDF
   * parser.
   */
  knownPageCount: number | null;
  declaredByteSize: number | null;
  verifiedByteSize: number | null;
  pageClaims: readonly EvidencePageClaim[];
};

/**
 * Tier 2: do the records about this document agree with each other?
 *
 * No document content is read. These compare what the client declared, what the
 * storage actually contains, and what the evidence links claim -- which is the
 * one family of real checks available while extraction is blocked.
 */
export function crossCheckFindings(subject: CrossCheckSubject): Finding[] {
  const findings: Finding[] = [];
  const { version } = subject;
  const citation = versionCitation(version);
  const base = { ruleVersion: CROSS_CHECK_RULE_VERSION, tier: "cross-check" as const, citation };

  if (!version.verifiedChecksum) {
    // Uncertain, not an issue. Nothing is wrong with the document; nobody has
    // read it. Under BLOCKED_INTEGRATION: malware-scanner-provider this is
    // every document, and calling it an issue would bury the real ones.
    findings.push(
      makeFinding({
        ...base,
        ruleKey: "content-identity-known",
        outcome: "uncertain",
        severity: "warning",
        detail:
          "No process has hashed the stored bytes, so their identity is the uploader's claim rather than a fact.",
      }),
    );
  } else if (version.declaredChecksum && version.declaredChecksum !== version.verifiedChecksum) {
    // The bytes in storage are not the bytes the client said they were sending.
    // Critical, and deterministic, so it genuinely holds a package back.
    findings.push(
      makeFinding({
        ...base,
        ruleKey: "content-identity-matches-claim",
        outcome: "issue",
        severity: "critical",
        detail:
          "The stored bytes do not hash to the checksum declared at upload. The file in storage is not the file that was described.",
      }),
    );
  } else {
    findings.push(
      makeFinding({
        ...base,
        ruleKey: "content-identity-matches-claim",
        outcome: "pass",
        severity: "info",
        detail: "The stored bytes hash to the checksum declared at upload.",
      }),
    );
  }

  if (
    subject.declaredByteSize !== null &&
    subject.verifiedByteSize !== null &&
    subject.declaredByteSize !== subject.verifiedByteSize
  ) {
    findings.push(
      makeFinding({
        ...base,
        ruleKey: "byte-size-matches-claim",
        outcome: "issue",
        severity: "warning",
        detail: `The upload declared ${subject.declaredByteSize} bytes and storage holds ${subject.verifiedByteSize}.`,
      }),
    );
  }

  for (const claim of subject.pageClaims) {
    if (claim.pageFrom === null) continue;
    const highestClaimed = claim.pageTo ?? claim.pageFrom;
    const pageCitation: FindingCitation = {
      kind: "version",
      documentVersionId: version.id,
      pageFrom: claim.pageFrom,
      pageTo: claim.pageTo,
    };

    if (subject.knownPageCount === null) {
      // The honest answer while nothing counts pages. Reporting `pass` here
      // would assert that a page range was checked when no page count exists.
      findings.push(
        makeFinding({
          ...base,
          ruleKey: "cited-pages-exist",
          outcome: "uncertain",
          severity: "info",
          detail: `Evidence cites pages ${claim.pageFrom}-${highestClaimed}, and the document's page count is not known, so the range could not be checked.`,
          citation: pageCitation,
        }),
      );
      continue;
    }

    if (highestClaimed > subject.knownPageCount) {
      findings.push(
        makeFinding({
          ...base,
          ruleKey: "cited-pages-exist",
          outcome: "issue",
          severity: "critical",
          detail: `Evidence cites page ${highestClaimed} of a document with ${subject.knownPageCount} pages.`,
          citation: pageCitation,
        }),
      );
    }
  }

  return findings;
}
