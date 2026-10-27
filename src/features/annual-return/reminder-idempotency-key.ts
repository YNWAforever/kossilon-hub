import { REMINDER_MILESTONES, type ReminderMilestone } from "@/lib/reminder-cadence";

export const ANNUAL_RETURN_REMINDER_KEY_PREFIX = "annual-return-reminder:";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedAnnualReturnReminderKey = {
  caseId: string;
  milestone: ReminderMilestone | null;
};

/**
 * Manual reminder identity for a new send. The command UUID replaces the
 * pre-increment counter and the phone. Historical rows stay
 * `annual-return-reminder:{caseId}:{phone}:{remindersSent}` and are not rewritten.
 */
export function annualReturnManualReminderIdempotencyKey(
  caseId: string,
  commandUuid: string,
): string {
  return `${ANNUAL_RETURN_REMINDER_KEY_PREFIX}${caseId}:${commandUuid}`;
}

/**
 * Reads the two facts the reconciler is allowed to publish out of an outbox
 * idempotency key, and nothing else.
 *
 * Key shapes that carry this prefix:
 *
 *   automated   annual-return-reminder:{caseId}:{milestone}:{channel}:{recipient}
 *   manual      annual-return-reminder:{caseId}:{commandUuid}
 *   historical  annual-return-reminder:{caseId}:{recipientPhone}:{remindersSent}
 *
 * The reconciler read segment 3 out of every shape as "the milestone". For a
 * historical manual reminder that segment is the client's PHONE NUMBER, which
 * then went into timeline_events.metadata.milestone -- mislabelled, and parked
 * in a table the outbox's 90-day redaction never reaches. A command UUID is not
 * a milestone either. So a segment is only a milestone if it IS one of the
 * milestones; anything else is reported as null rather than guessed at, which
 * also keeps a further key shape from leaking a recipient.
 *
 * Returning null rather than throwing on a malformed key is the point of it
 * being a parser. `${row.case_id}::uuid` was the first statement of every sweep
 * transaction, so one row whose second segment is not a uuid threw before
 * anything else ran -- and because a settled row never goes away, the reminder
 * sweep would die on it on every five-minute tick, forever. The caller skips
 * such a row instead.
 */
export function parseAnnualReturnReminderKey(key: string): ParsedAnnualReturnReminderKey | null {
  if (!key.startsWith(ANNUAL_RETURN_REMINDER_KEY_PREFIX)) return null;

  const segments = key.split(":");
  const caseId = segments[1];
  if (!caseId || !UUID_PATTERN.test(caseId)) return null;

  const candidate = segments[2];
  const milestone = REMINDER_MILESTONES.find((value) => value === candidate) ?? null;

  return { caseId, milestone };
}
