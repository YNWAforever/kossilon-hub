import { daysBetween } from "@/lib/date-math";

export type OtherWorkSource = {
  business: "incorporation" | "corporate_change";
  id: string;
  companyName: string;
  ownerId: string | null;
  ownerName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  dueDate: string | null;
  status: string;
  statusAt: string | null;
  completedAt: string | null;
  requiredCount: number;
  missingLabels: string[];
  receivedCount: number;
};

export type OtherWorkRow = {
  business: OtherWorkSource["business"];
  target: "/incorporation/$id" | "/corporate-changes/$id";
  caseId: string;
  companyName: string;
  ownerName: string | null;
  reviewerName: string | null;
  dueDate: string | null;
  daysRemaining: number | null;
  status: string;
  statusAt: string | null;
  blocker: string;
  nextStep: string;
  readyForApproval: false;
};

/** A read projection only: checklist labels cannot approve an external filing. */
export function otherWorkRow(source: OtherWorkSource, today: string): OtherWorkRow | null {
  if (source.completedAt || ["Completed", "Cancelled"].includes(source.status)) return null;
  const [blocker, nextStep] =
    source.status === "Filed with Registrar"
      ? ["已提交登記處，等待結果核對", "核對登記結果及回件"]
      : source.missingLabels.length
        ? [source.missingLabels[0], "追收及核對缺少文件"]
        : source.receivedCount > 0
          ? [`${source.receivedCount} 份文件待內部覆核`, "覆核已收到文件"]
          : source.requiredCount === 0
            ? ["文件需求未能判定", "確認文件需求及負責人"]
            : source.status === "Documents pending"
              ? ["文件清單已核對，案件仍未完成；交件資格尚待核實", "人手核對交件證據及案件下一步"]
              : ["交件資格尚待個案證據核實", "開啟個案核對交件證據"];
  return {
    business: source.business,
    target: source.business === "incorporation" ? "/incorporation/$id" : "/corporate-changes/$id",
    caseId: source.id,
    companyName: source.companyName,
    ownerName: source.ownerName,
    reviewerName: source.reviewerName,
    dueDate: source.dueDate,
    daysRemaining: source.dueDate ? daysBetween(today, source.dueDate) : null,
    status: source.status,
    statusAt: source.statusAt,
    blocker,
    nextStep,
    readyForApproval: false,
  };
}
