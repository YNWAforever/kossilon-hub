## Goal

Give staff a client-facing AI assist in the WhatsApp Inbox that suggests draft replies grounded in a curated FAQ, uploaded reference documents, the active client's live case state, and the checklist templates from Settings. Everything is mocked (no live model call) but the UX shows end-to-end how retrieval + drafting would work.

## What gets added

### 1. Knowledge base (Settings)

A new **Knowledge base** section in `/settings`, alongside the existing Checklist templates card.

**FAQ manager**

- Table of Q&A entries with: question, answer (markdown), category (Incorporation / Annual Return / Payments / Deregistration / General), tags, active toggle.
- Inline editing + Add / Duplicate / Delete.
- Seeded with ~12 realistic HK CoSec FAQs (fees, NAR1 timing, penalties, share transfer, deregistration steps, payment methods, turnaround times, etc.).

**Reference documents**

- Card listing "uploaded" reference docs (mocked file entries — no real upload): title, filename, category, short summary, updated date, active toggle.
- Add / edit / delete rows. A "Simulate upload" button appends a new mock entry so the flow is demoable.
- Seeded with ~6 docs (Fee schedule 2026, HK CoSec SOP, NAR1 filing guide, KYC checklist, Payment terms, Deregistration playbook).

Both stored in a new module store `src/lib/knowledge-base.ts` (same `useSyncExternalStore` pattern already used for templates + clients).

### 2. AI-suggested replies in WhatsApp Inbox

Rework the existing right rail on `/whatsapp` (currently a static "Suggested next step" card) into an **AI Assistant** panel:

- **Draft reply card** — auto-generated draft based on the current enquiry (intent + last message) and linked client case if the phone maps to a converted client:
  - Header shows model badge ("Kossilon AI · mocked"), confidence, and a **Regenerate** button.
  - Body renders markdown (add `react-markdown` + `remark-gfm`).
  - Actions: **Insert into composer**, **Send as-is**, **Copy**.
- **Sources used** — chips listing the FAQs, documents, checklist template items, and case fields the draft cited. Each chip is clickable and expands a small preview.
- **Live case context** — if the enquiry is tied to a client (via `useEnquiryConversion` or phone match), show: company name, active case status, days-to-due, missing docs count, payment status. Link to the case.
- **Related FAQs** — top 3 matches surfaced independently for one-click send.

Composer changes:

- Textarea becomes controlled state so "Insert into composer" works.
- Small "AI ✨" button in the composer footer to re-open the draft.

### 3. Mocked "retrieval + drafting" engine

New file `src/lib/ai-agent.ts` — deterministic, no network:

- `retrieveContext(enquiry, clientCase?)` → scores FAQ entries + documents by keyword overlap with `enquiry.lastMessage` + `enquiry.intent`, returns top matches with a numeric score.
- `draftReply(enquiry, context, caseCtx?)` → templated markdown reply that composes: greeting → intent-specific answer stitched from top-1 FAQ answer → case-specific line (deadline, missing docs) when a case exists → next-step CTA (send quote, request docs, book call) → sign-off "— Kossilon team".
- `suggestedFaqs(enquiry)` → top 3 FAQ IDs by score.

All pure functions so re-renders and "Regenerate" produce stable, believable output.

### 4. Small touch-ups

- Sidebar: no new route; Knowledge base lives inside Settings to keep the nav lean.
- Case detail: add a subtle "Ask the AI about this case" button in the header that deep-links to `/whatsapp` opened on the client's enquiry (if any). Skip if no matching enquiry.
- Toast on Insert / Send so the interaction feels responsive.

## Files

**New**

- `src/lib/knowledge-base.ts` — types, seeds, store, hooks (`useFaqs`, `useReferenceDocs`, mutators).
- `src/lib/ai-agent.ts` — `retrieveContext`, `draftReply`, `suggestedFaqs`.
- `src/components/knowledge-base-section.tsx` — FAQ + docs UI mounted inside Settings.
- `src/components/ai-assistant-panel.tsx` — right-rail panel used by WhatsApp Inbox.

**Edited**

- `src/routes/settings.tsx` — mount `<KnowledgeBaseSection />` below Checklist templates.
- `src/routes/whatsapp.tsx` — replace static right rail with `<AiAssistantPanel />`, controlled composer state, wire Insert / Send / Regenerate.
- `src/routes/annual-returns.$id.tsx` — small "Ask AI" link when a matching enquiry exists.
- `package.json` — add `react-markdown`, `remark-gfm`.

## Out of scope

- No real model call, no server route, no Lovable AI Gateway wiring (mocked flag surfaced on the panel).
- No real file uploads or storage; reference documents are metadata-only mock rows.
- No changes to auth, roles, or backend.

## Verification

- Create/edit/delete a FAQ and a document in Settings and see them affect suggestions immediately.
- Open each enquiry in `/whatsapp`; draft reply, sources, related FAQs, and case context all render sensibly and change per enquiry.
- Click **Insert into composer** and confirm the textarea fills; **Regenerate** produces a fresh draft; toggling a FAQ off in Settings removes it from suggestions.
- `bunx tsgo --noEmit` passes.
