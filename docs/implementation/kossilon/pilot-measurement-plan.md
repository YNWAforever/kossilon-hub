# Pilot measurement plan

Plan §9, F3. Written 2026-09-11, before any measurement exists.

## The rule this document exists to enforce

> "Treat proposed improvement targets as targets. Do not report saved hours,
> accuracy or adoption as actual without measured evidence."

No number in this repository is a measurement. Every metric below would compute
to zero today, over an empty database, and a dashboard of zeros looks exactly
like a result. That is why F3 ships as this plan and not as a screen.

## Which metrics the system can compute, and which it cannot

The split matters more than the list. A metric the product can derive is
collected for free once there is data; a metric that needs a person watching has
to be scheduled, staffed and paid for, and pretending otherwise is how a pilot
ends with no baseline.

### Derivable from tables that already exist

| Metric | Source | Caveat |
|---|---|---|
| Review turnaround | `documents` received → the review decision on it | Needs the pilot to actually review in the product, not beside it. |
| Repeated chases per case | `notification_outbox` rows per case/period | Only counts what the product sent. A staff member who also messaged by hand is invisible here — count that in the observed set. |
| Cases completed through the workspace | `annual_return_cases` reaching `Filed`/`Completed` with a manifest | The denominator is every case in the pilot cohort, including the ones that fell back to the spreadsheet. |
| Missing returned documents | `handoff_returns` unreconciled | **Unavailable.** `BLOCKED_INTEGRATION: external-handoff-destination` — nothing transmits, so nothing returns. |
| Document matching errors | Findings resolved as wrong-match | Weak signal until text extraction exists; today a match is a human judgement the product only records. |
| AI false positives / negatives | Provider findings vs. reviewer decisions | **Unavailable.** `BLOCKED_INTEGRATION: ai-provider` — no model runs, so the rate is not zero, it is undefined. |

### Requires a person observing

| Metric | Why it cannot be derived |
|---|---|
| Staff minutes per case step | The product sees a request arrive and a row change. It cannot see the reading, the phone call, or the twenty minutes spent finding the right file. |
| Steps still needing a parallel spreadsheet | By definition these happen outside the product. |
| Steps needing an ID copied by hand | Same. This is the single most useful thing to watch for, because it names a missing link rather than a missing feature. |

Plan F1 asks to "observe staff completing tasks, not just viewing screens".
That instruction is aimed squarely at this second table.

## Baseline before pilot

A pilot with no before-measurement can only produce anecdotes. Collect the
observed metrics for the **current** spreadsheet-and-WhatsApp process, for the
same staff, before they are given the product. Two weeks is enough to see a
month-end.

## Unacceptable outcomes, agreed before starting

Plan F3 requires these to be named in advance rather than judged afterwards. A
pilot that produces any of them stops, regardless of how the other numbers look:

- A document or message reaching the wrong client.
- An approval recorded against a manifest a human did not actually review.
- A source file the firm supplied that the product lost, or silently did not
  ingest.
- A package released against a stale manifest — evidence that moved after the
  approval.

The first three are outcomes to watch for. The fourth is already structurally
refused: `refusalForHandoff` rejects a handoff whose current manifest hash does
not equal the approved one.

## What a pilot report may say

It may report the observed and derived numbers, with their collection method and
their cohort size. It may report which of the unacceptable outcomes occurred.

It may **not** report saved hours, an accuracy rate, or adoption, unless the
baseline above was collected first — and it may not report an AI or handoff
metric at all while those integrations are blocked, because the absence of a
finding is not a true negative when nothing ran.
