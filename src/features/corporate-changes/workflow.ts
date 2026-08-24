import type { CorporateChangeStatus, CorporateChangeType } from "./types";
import { CORPORATE_CHANGE_STATUSES } from "./types";

const FORWARD_ONLY_STATUSES: readonly CorporateChangeStatus[] = CORPORATE_CHANGE_STATUSES.filter(
  (status) => status !== "Cancelled",
);

export function isAllowedCorporateChangeStatusTransition(
  from: CorporateChangeStatus,
  to: CorporateChangeStatus,
): boolean {
  if (to === "Cancelled") {
    return from !== "Completed" && from !== "Cancelled";
  }

  const fromIndex = FORWARD_ONLY_STATUSES.indexOf(from);
  const toIndex = FORWARD_ONLY_STATUSES.indexOf(to);

  if (fromIndex < 0 || toIndex < 0) return false;

  return toIndex === fromIndex + 1;
}

const CHECKLIST_LABELS: Record<CorporateChangeType, readonly string[]> = {
  name_change: [
    "Special resolution approving new name",
    "NNC2 form",
    "Updated Business Registration certificate",
    "Certificate of Change of Name",
  ],
  share_transfer: [
    "Bought & Sold Note",
    "Instrument of Transfer",
    "Transferee ID/address proof",
    "Stamp duty payment receipt",
    "Updated register of members",
  ],
  officer_change: [
    "ND2A/ND2B form",
    "New officer's ID/address proof",
    "Updated register of directors and secretaries",
  ],
  address_change: ["NR1 form", "Proof of new address", "Updated Business Registration certificate"],
};

export function checklistLabelsFor(changeType: CorporateChangeType): readonly string[] {
  return CHECKLIST_LABELS[changeType];
}
