import type { JobResult, MaintenanceActionKind, BulkResource } from "./types";
export const bulkOperationLabels: Record<"assignment" | MaintenanceActionKind, string> = {
  assignment: "分派負責人／覆核人",
  client_maintenance: "客戶分派維護",
  document_assignment: "文件所屬案件分派",
  document_return_draft: "文件退回草稿",
  document_list_export: "文件登記清單",
  follow_up_draft: "追件草稿",
  payment_list_export: "款項核對清單",
};
export function bulkResourceHref(resource: BulkResource, id: string) {
  return resource === "annual_return_case"
    ? "/annual-returns/" + id
    : resource === "client_company"
      ? "/clients/" + id
      : resource === "document"
        ? "/documents?documentId=" + id
        : "/work-queue?anchor=" + id;
}
export function bulkPollInterval(
  visible: boolean,
  state: JobResult["state"] | undefined,
  failures: number,
) {
  return visible && (state === "queued" || state === "running")
    ? Math.min(5000 * 2 ** Math.min(failures, 4), 60000)
    : false;
}
