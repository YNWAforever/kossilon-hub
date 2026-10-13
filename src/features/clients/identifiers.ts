/**
 * Hong Kong company identifiers as staff type them.
 *
 * The client forms only checked "not empty", so a company could be saved with
 * CR "12" and BR "abc" — and, since both columns are unique, that bad value
 * then blocked the real one. These are the formats the Companies Registry and
 * the IRD issue:
 *
 *  - CR (Company Registration) number: 7 digits, 8 for the newest companies,
 *    with an "F" prefix for registered non-Hong Kong companies.
 *  - BR (Business Registration) number: the 8-digit file number, optionally
 *    followed by the 3-digit branch number (12345678-000).
 *
 * Spaces are ignored, so a number pasted from a certificate still validates.
 */
const CR_NUMBER = /^F?\d{7,8}$/;
const BR_NUMBER = /^\d{8}(-\d{3})?$/;

export const CR_NUMBER_MESSAGE = "CR 號碼須為 7 或 8 位數字（非香港公司以 F 開頭）。";
export const BR_NUMBER_MESSAGE = "BR 號碼須為 8 位數字，可附 3 位分行號碼（例如 12345678-000）。";

export function normalizeCrNumber(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function normalizeBrNumber(value: string): string {
  return value.replace(/\s+/g, "");
}

export function isValidCrNumber(value: string): boolean {
  return CR_NUMBER.test(normalizeCrNumber(value));
}

export function isValidBrNumber(value: string): boolean {
  return BR_NUMBER.test(normalizeBrNumber(value));
}
