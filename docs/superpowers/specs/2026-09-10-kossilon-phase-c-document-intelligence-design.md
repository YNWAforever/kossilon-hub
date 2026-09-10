# Kossilon Phase C — Document intelligence and accountable Kossilon review (Design)

## Overview

Staff can see exactly which material is missing or questionable, inspect the original
evidence, and approve a specific package version. AI findings never become a human
approval.

Verified against this branch (`codex/kossilon-phase-c`, from `codex/kossilon-phase-b`).
The single most important fact about Phase C is what is *not* here: there is no AI
provider in this repository at all. A repo-wide grep for
`anthropic|openai|gpt-|claude-|gemini|bedrock|llm|tesseract|ocr|textract|embedding`
across `src/`, `scripts/`, `db/`, `package.json` and the wrangler config returns only
false positives. Nothing reads a document and decides anything.

---

## C-0: Three claims the product already makes and cannot support

These come first because they are live, and because each one teaches a staff member to
trust something that is not there. Fixing them is not cosmetic; it is the precondition
for adding a real capability without the real one being indistinguishable from the
theatre it replaces.

### The production dashboard says "AI daily digest"

`src/routes/index.tsx:158` renders that heading, with a `Sparkles` icon, and it is **not
inside a `dataMode` branch** — the route's only mode switch is in the loader at line 27.
So a firm principal looking at live Postgres metrics reads "AI daily digest" and
reasonably concludes the platform already runs AI over their caseload.

What is behind it is `buildDailyDigest`, a pure scoring function with a hardcoded weight
table (`daily-digest.ts:35-39`). That is a perfectly good rule engine and it should keep
its place on the dashboard — under a name that says what it is.

### "Confidence 96%" is a count of rows, not a measure of anything

`ai-agent.ts:254-260`:

```ts
const confidence = Math.min(96, 70 + context.faqs.length * 4 + context.documents.length * 3 + (annualReturnContext || clientCase ? 8 : 0));
```

`faqs` is capped at 4 and `documents` at 3, so this is a pure arity function bounded to
70–96. Run against zero matched FAQs, zero matched documents and no linked case it still
prints **70%**. It is rendered to staff as `Confidence {draft.confidence}%`
(`ai-assistant-panel.tsx:96`), and "Regenerate" perturbs it arithmetically rather than
recomputing anything. The plan forbids exactly this: no synthetic certainty percentage
derived from how many FAQs were retrieved.

### Both tokenizers delete Chinese

`ai-agent.ts:73-79` and `doc-parser.ts:114-120` both normalise with an ASCII-only class
(`[^a-z0-9]+` / `[^a-z0-9 ]+`), and they are the entire retrieval layer. Executed
directly:

```
tokenize("請問週年申報表的費用是多少？") -> []
tokenize("陳大文董事身分證")           -> []
tokenize("annual return fee")          -> ["annual","return","fee"]
```

Every CJK codepoint becomes a space. For a Hong Kong company-secretary platform whose own
`CLAUDE.md` opens by saying so, a client writing in Chinese retrieves nothing, and the
reply is selected by the intent chip and a constant boost list alone — identical for
every Chinese message with that intent, presented at up to 96% confidence.

---

## C-1: A document that has versions

`documents` has no version column, no supersession pointer and nothing content-derived
(`schema.sql:55-68`). The nearest thing to a version is one row per upload attempt in
`document_upload_intents`. So "approve this exact version" cannot be expressed, and a
replacement upload has no defined relationship to the file it replaces.

`document_versions` makes the version the thing findings and approvals point at: content
hash, size, content type, the intent that produced it, a supersedes pointer, and the
extracted-text artefact kept **separate from the original bytes**. An analysis run can
never overwrite an original or a prior human decision.

Phase B's `requirement_evidence_links` already carries the document and page range a
finding needs to cite, so C attaches to that model rather than inventing a parallel one.

## C-2: A pipeline that runs, and a provider that is honestly absent

Analysis is durable work, claimed with the same lease-and-fence mechanics as
`document_scan_jobs` and `notification_outbox`: `for update skip locked`, `attempt_count`
incremented at claim and used as a fencing token in every terminal write, exponential
backoff, and a visibility timeout that reclaims a job whose worker died. That pattern is
proven twice in this codebase; a third invention would be the mistake.

It runs **only after a real malware verdict**. Phase A already refuses to release a file
the fixture scanner passed, and analysis inherits that: unknown safety is not analysed.

Three tiers, in order, and the first two need no provider:

1. **Classification and readability** — file type, page count, encrypted, corrupt,
   empty-text-layer. Deterministic.
2. **Deterministic rule checks** — the requirement, date and consistency checks that can
   be stated as rules: an address proof older than the configured window measured in
   calendar months from a stated reference date; a document whose extracted year does not
   match the case's return year; a required page absent.
3. **Provider-assisted classification and extraction** — `BLOCKED_INTEGRATION: ai-provider`.
   The adapter is implemented against a strict response schema with an explicit
   `uncertain` outcome, contract-tested against a stub, and **disabled**: a sibling
   accessor like `getDocumentScannerConfig` rather than an entry in `REQUIRED_BINDINGS`,
   whose all-or-nothing throw has already taken down document reads twice.

**Every finding cites its source or says it has none.** A missing-file finding carries no
document and no page, because there is nothing to cite; fabricating a page reference for
an absent document is the specific failure this contract exists to prevent.

**Document text is untrusted evidence.** Extracted text, OCR output and message bodies
cannot change a checklist, a recipient, a permission or an approval. The pipeline passes
them as data, never as instructions, and an adversarial fixture — a document whose text
says to ignore the missing material and approve the case — is part of the suite.

## C-3: The checklist, applied per person

Phase B's `case_requirement_instances` already carries applicability per party and a
template version. C adds the approved annual-return template that produces them: NAR1,
CDD, AGM, updated HKID or passport, and address proof within the agreed three-calendar-
month rule, with applicability decided per person.

The three-month rule is calendar months from a configured reference date, not 90 days,
and an unknown issue date is an unknown — never treated as recent.

## C-4: Findings in the review workspace

Requirement status, party, latest version, cited page, AI finding and the human decision
on one screen. Outcomes are Approve, Request correction, Needs investigation, and
Authorized not applicable.

No synthetic certainty percentage. A finding is `pass`, `issue` or `uncertain` with its
evidence attached; `uncertain` is a first-class outcome rather than a low number, because
"we could not tell" is information a reviewer can act on and "62%" is not.

## C-5: The package approval contract

An immutable manifest of requirements, applicable parties, exact document versions and
hashes, the case revision and the rule versions, hashed; a Kossilon approval recorded
over that manifest hash. A manifest with an unresolved critical finding, a missing
required human decision or stale evidence is not releasable.

**AI has no package-approve permission**, and no automatic worker output can populate a
human decision field. Phase E implements the external handoff; C stops at the approval.

## Testing

Pure domain logic dependency-injected and DB-free; repository behaviour in
`describe.skipIf(!databaseUrl)` integration tests registered in
`src/test/db-integration-files.ts`; the provider adapter as an isolated contract test
against a stub transport. `BLOCKED_INTEGRATION: local-postgres` still applies.

## Out of scope for Phase C

- Real media intake from WhatsApp (Phase D).
- The external handoff and folder returns (Phase E).
- Choosing or provisioning an AI vendor. The adapter is written and disabled.
