# Next service: incoming government mail and forwarding

Plan §9, F4. A small extension spec, 2026-09-11.

## The choice is not confirmed

F4 says to identify the next workflow **with Kossilon**. That conversation has
not happened. This spec takes the plan's own first example — incoming government
mail and forwarding — because it is the one that reuses the most of what A–E
built and adds the least. **The firm may well pick the other example
(corporate-change intake and quotation) or a third thing, and this spec should be
rewritten rather than argued with if they do.**

Nothing here should be built before the NAR flow passes its pilot. Plan F4 is
explicit that this phase's completion does not depend on it.

## What the workflow is

Government mail arrives at the firm's registered-office address for client
companies: Companies Registry notices, IRD returns and demands, court documents.
Someone opens it, works out which company it belongs to, decides whether it needs
action or only forwarding, tells the client, and keeps a record that it was
forwarded.

It is the same shape as the annual-return flow with the arrow reversed. NAR
chases evidence _from_ a client towards a filing; this receives a document _for_
a client and pushes it out. Which is exactly why it is the cheap next step: the
contracts already exist, and every one of them is directional in a way that
accommodates both.

## Mapping onto the existing contracts

| Existing contract                 | How this workflow uses it                                                                                                                                                                                                                      | New work                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `companies`                       | The addressee. Matching an envelope to a company is the whole first step.                                                                                                                                                                      | None. `company_external_references` already holds the firm's own client IDs, which is what an envelope is most likely to quote. |
| `case_parties`                    | A notice can be addressed to a _director personally_ rather than to the company — a disqualification notice, a personal tax matter. The per-party model built in C-3 is what stops that being filed as company correspondence.                 | None.                                                                                                                           |
| `case_requirement_instances`      | Not every piece of mail creates an obligation, and inventing a requirement for each would flood the checklist. Only mail with a deadline (an IRD return, a Registry notice with a reply-by date) becomes a requirement instance.               | A rule for which mail types carry a deadline. Business input, not code.                                                         |
| `documents` + `document_versions` | The scan of the envelope's contents is a document like any other, with the same immutable bytes, the same content identity and — critically — the same malware gate.                                                                           | None. Blocked the same way: `BLOCKED_INTEGRATION: malware-scanner-provider` gates this too.                                     |
| `notification_outbox`             | Forwarding _is_ an outbound message with a document attached. The idempotency key, the fencing token and the `sent_as` record all apply unchanged.                                                                                             | None.                                                                                                                           |
| `package_handoffs`                | **Does not apply, and should not be reused.** A handoff is a package leaving for a filing agent under an approval. Forwarding mail to a client is not that, and stretching the table to cover both would make "has this been filed" ambiguous. | A separate, simpler forwarding record.                                                                                          |

## The two things this workflow needs that nothing in A–E has

**1. An arrival that no client action created.**

Every document in the system today arrives because someone was asked for it: an
upload intent, a checklist item, a chase. Government mail arrives unbidden and
unmatched. So the intake needs a state before a company is known — an envelope
that exists, is scanned, and is _not yet_ attributable. That state has to be
first-class rather than a null `company_id`, for the same reason `unmatched` is a
first-class return outcome in E: a piece of mail nobody could match is precisely
the thing that must not become invisible.

**2. Forwarding is evidence, not a notification.**

A reminder that failed can be resent. A statutory notice that was never forwarded
is a liability, and "we sent a WhatsApp" is not the same claim as "the client
received the document". The forwarding record needs to distinguish _dispatched_
from _acknowledged_ the way `package_handoffs` distinguishes `transmitted` from
`acknowledged` — and, like that table, it must not let a dispatch imply a receipt.

## What this spec deliberately does not propose

- **No multi-tenant redesign.** The deployment is firm-oriented and stays so.
- **No billing engine, and no quotation.** That is the _other_ candidate
  workflow, and mixing them would produce a spec for neither.
- **No OCR-driven auto-matching.** Matching an envelope to a company by reading
  it needs `BLOCKED_INTEGRATION: document-text-extraction`, which does not exist.
  The first version matches by a person, with the product narrowing the list.
- **No new Company or Case authority.** Plan §10.1: mail attaches to the existing
  `companies`, and a deadline-bearing notice attaches to a case.

## Before any of this is built

It needs its own scoped acceptance plan, and it needs the NAR flow to have
passed a real pilot. Building a second workflow on contracts that have never run
against a database would double the amount of unverified work rather than prove
anything about either.
