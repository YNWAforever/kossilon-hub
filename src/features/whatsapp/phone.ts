/**
 * Digits-only canonicalisation, used ONLY to compare phone numbers that were
 * written by different normalizers. Three mutually incompatible formats exist:
 *
 *   inbound-created contacts   "85260903521"      (WOZTELL's `from` is bare digits,
 *                                                  and normalizePhone only preserves
 *                                                  a leading "+", never adds one)
 *   sweep recipients           "+852 6090 3521"   (raw company_contacts.phone)
 *   staff sends                "+85260903521"     (normalizePhone with a typed "+")
 *
 * Digits-only is the one representation all three agree on, and is already what
 * goes on the wire as WOZTELL's `recipientId`.
 *
 * This is a COMPARISON helper, never a storage format. It does not replace either
 * normalizePhone copy (woztell.ts, repository.ts) and no write path uses it.
 */
export function toPhoneDigits(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
