// Turns a kebab-case database value into a display label: "payment-pending"
// becomes "Payment Pending".
//
// Takes null and undefined even though the callers' types say it cannot. Those
// types are compile-time claims about a database this code does not own. A NULL
// column, or a field JSON.stringify drops in transit because it was undefined,
// both arrive here — and inside .split() either one threw, which turned a
// single missing label into a white screen for the whole route.
//
// The placeholder is deliberately visible. An em dash in the column tells a
// reader that one record is short a value; the crash told them nothing at all.
export function labelValue(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";

  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
