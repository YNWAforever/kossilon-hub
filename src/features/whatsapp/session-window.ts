/** WhatsApp allows free-form text only within 24 hours of the contact's last inbound message. */
export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * `now` accepts a string because this pipeline's clock is ISO text, not a Date:
 * NotificationDispatcher.dispatchDue(now: string) (notifications/types.ts) is fed
 * `new Date(scheduledTime).toISOString()` by the cron (src/server.ts).
 *
 * The boundary is EXCLUSIVE — exactly WHATSAPP_SESSION_WINDOW_MS old is outside —
 * and no safety margin is applied, because boundary error self-heals in the
 * dangerous direction. Guessing "inside" costs one rejected attempt that then
 * retries as a template; guessing "outside" only downgrades to a template. A
 * margin would convert that self-healing delay into an unconditional loss of the
 * composed body for every client landing in the last N minutes.
 *
 * The comparison is inherently cross-clock and that is accepted: lastInboundAt
 * derives from WOZTELL's epoch-seconds timestamp (Meta's clock, second-truncated,
 * biasing fail-closed), while `now` is the cron's intended tick (ours, biasing
 * fail-open under delivery drift). Both are bounded by seconds.
 *
 * Anything unparseable fails closed — a template is always deliverable, free-form
 * outside the window is not.
 */
export function isWithinSessionWindow(
  lastInboundAt: string | Date | null,
  now: string | Date,
): boolean {
  if (lastInboundAt === null) return false;

  const last = new Date(lastInboundAt).getTime();
  const current = new Date(now).getTime();
  if (Number.isNaN(last) || Number.isNaN(current)) return false;

  return current - last < WHATSAPP_SESSION_WINDOW_MS;
}
