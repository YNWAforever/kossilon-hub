// Display formatting for the ISO date strings the repositories return.
// Lives outside lib/mock-data so production screens do not import fixtures
// to render a date.
export const formatDate = (isoDate: string) => {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-HK", { day: "2-digit", month: "short", year: "numeric" });
};
