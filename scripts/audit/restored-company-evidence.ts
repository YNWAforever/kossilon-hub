type WorkspaceReader = {
  summary(): Promise<{
    partial: boolean;
    openCases: number;
    documents: number;
    paymentCases: number;
  }>;
  cases(): Promise<{ partial: boolean }>;
  documents(): Promise<unknown>;
  payments(): Promise<unknown>;
  activity(): Promise<{ items: unknown[] }>;
};
/** Receipt only after every required reader succeeds; a partial source is not acceptance. */
export async function observeCompanyWorkspace(repository: WorkspaceReader) {
  const summary = await repository.summary();
  if (summary.partial)
    throw Error("BLOCKED: current company summary is partial on the restored schema.");
  const cases = await repository.cases();
  if (cases.partial)
    throw Error("BLOCKED: current company cases are partial on the restored schema.");
  await repository.documents();
  await repository.payments();
  const activity = await repository.activity();
  return {
    observed: true,
    tabs: ["overview", "cases", "documents", "payments", "activity"],
    openCases: summary.openCases,
    documents: summary.documents,
    paymentCases: summary.paymentCases,
    activityRows: activity.items.length,
  };
}
