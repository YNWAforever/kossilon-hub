import type { DocumentVersionState } from "@/features/documents/versions";
import { blocksRelease } from "@/features/documents/findings";
import type { DocumentStatus, ScanVerdictSource } from "@/features/documents/types";
import { documentSafetyOf } from "@/features/documents/safety";
import {
  buildPackageManifest,
  canonicalManifestPayload,
  type FindingState,
  type ManifestCandidateEntry,
} from "./package-manifest";
import type { RequirementInstanceState } from "./requirements";
import type { AnnualReturnCase } from "./types";

export type ReadinessStage = "prepare" | "approval" | "transmit";
export type ReadinessBlocker = {
  code: string;
  stage: ReadinessStage;
  message: string;
  action: string;
};
export type ReadinessSnapshot = {
  sourceVersion: string | null;
  readyToPrepare: boolean;
  readyForApproval: boolean;
  readyToTransmit: boolean;
  blockers: ReadinessBlocker[];
  /** Canonical candidate, never an approval or a receipt. */
  manifestPayload: string | null;
};
export type ReadinessDocument = {
  id: string;
  companyId: string;
  caseId: string | null;
  category: string;
  reviewStatus: "pending" | "verified" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  versionCreatedAt: string | null;
  uploadStatus: DocumentStatus | null;
  scanVerdictSource: ScanVerdictSource | null;
  currentSourceMatches: boolean;
  version: DocumentVersionState | null;
};
export type ReadinessRequirement = {
  instance: RequirementInstanceState;
  templateVersion: string;
  authorizedBy: string | null;
  documentIds: string[];
  decisionAt?: string | null;
  evidenceLinks?: { documentId: string; pageFrom: number | null; pageTo: number | null }[];
};
export type ReadinessInput = {
  case_: AnnualReturnCase;
  sourceVersion: string;
  partiesKnown: boolean;
  documents: ReadinessDocument[];
  requirements: ReadinessRequirement[];
  findings: readonly FindingState[];
  approvedPayload: string | null;
  destinationConfigured: boolean;
};

function usable(document: ReadinessDocument | undefined, case_: AnnualReturnCase): boolean {
  const version = document?.version;
  return Boolean(
    document &&
    version &&
    document.companyId === case_.companyId &&
    (document.caseId === case_.id || document.caseId === null) &&
    document.currentSourceMatches &&
    document.reviewStatus === "verified" &&
    document.reviewedBy &&
    document.reviewedAt &&
    document.versionCreatedAt &&
    Date.parse(document.reviewedAt) >= Date.parse(document.versionCreatedAt) &&
    version.supersededByVersionId === null &&
    version.verifiedChecksum &&
    version.declaredChecksum === version.verifiedChecksum &&
    documentSafetyOf(document) === "verified",
  );
}

/** Unknown metadata cannot become ready by counting business verification labels. */
export function computeReadiness(input: ReadinessInput): ReadinessSnapshot {
  const { case_ } = input;
  const blockers: ReadinessBlocker[] = [];
  const add = (
    code: string,
    stage: ReadinessStage,
    message: string,
    action = `/annual-returns/${case_.id}`,
  ) => blockers.push({ code, stage, message, action });
  const documents = new Map(input.documents.map((document) => [document.id, document]));
  if (case_.lockedAt || case_.completedAt || ["Filed", "Completed"].includes(case_.currentStatus))
    add("case_closed_or_locked", "prepare", "案件已交件、結案或鎖定，不能重新準備交件。");
  if (!input.partiesKnown)
    add("party_applicability_unknown", "prepare", "案件人士及文件適用性尚未確認，先由人手核對。");
  if (!case_.checklist.length || !input.requirements.length)
    add("requirements_unknown", "prepare", "未有完整文件需求，不能視為齊件。");
  for (const item of case_.checklist.filter((item) => item.required)) {
    const instances = input.requirements.filter(
      (requirement) => requirement.instance.checklistItemId === item.id,
    );
    const resolvedWithoutEvidence =
      instances.length > 0 &&
      instances.every(
        (requirement) =>
          requirement.instance.applicability !== "required" &&
          requirement.authorizedBy &&
          requirement.decisionAt &&
          requirement.instance.applicabilityReason?.trim(),
      );
    if (resolvedWithoutEvidence) continue;
    if (item.status === "Received")
      add(
        "internal_review_pending",
        "prepare",
        `${item.itemLabel} 已收，等內部覆核。`,
        `/documents?caseId=${case_.id}`,
      );
    else if (item.status !== "Verified")
      add(
        "required_document_missing",
        "prepare",
        `${item.itemLabel} 尚欠可用文件。`,
        `/documents?caseId=${case_.id}`,
      );
    else if (
      !item.receivedAt ||
      !item.verifiedAt ||
      !usable(documents.get(item.documentId ?? ""), case_)
    )
      add(
        "required_evidence_unverified",
        "prepare",
        `${item.itemLabel} 欠當前版本、安全掃描或人手覆核證據。`,
        `/documents?caseId=${case_.id}`,
      );
    if (!input.requirements.some((requirement) => requirement.instance.checklistItemId === item.id))
      add("requirements_unknown", "prepare", `${item.itemLabel} 未有適用需求實例。`);
  }
  if (
    case_.payment?.status !== "Payment received" ||
    !case_.payment.paidAt ||
    !Number.isFinite(case_.payment.receivedAmount) ||
    !Number.isFinite(case_.payment.amount) ||
    case_.payment.amount <= 0 ||
    (case_.payment.receivedAmount ?? 0) < case_.payment.amount
  )
    add(
      "payment_not_received",
      "prepare",
      "款項未確認收妥，請核對實際付款及餘額。",
      `/payments?caseId=${case_.id}`,
    );
  else {
    const proof = documents.get(case_.payment.paymentProofDocumentId ?? "");
    if (!usable(proof, case_) || proof?.category !== "payment")
      add(
        "payment_proof_unverified",
        "prepare",
        "付款證據未有當前安全版本及人手覆核。",
        `/payments?caseId=${case_.id}`,
      );
  }
  const candidates: ManifestCandidateEntry[] = input.requirements.map((requirement) => {
    const instance = requirement.instance;
    const waived = instance.applicability !== "required";
    if (
      waived &&
      (!requirement.authorizedBy ||
        !requirement.decisionAt ||
        !instance.applicabilityReason?.trim())
    )
      add(
        "applicability_not_authorized",
        "prepare",
        `${instance.requirementKey} 不適用／豁免欠批准及原因。`,
      );
    const document = requirement.documentIds
      .map((id) => documents.get(id))
      .find((doc) => usable(doc, case_));
    if (!waived && !document) {
      const received = requirement.documentIds.some(
        (id) => documents.get(id)?.reviewStatus === "pending",
      );
      add(
        received ? "internal_review_pending" : "required_evidence_unverified",
        "prepare",
        `${instance.requirementKey}${instance.partyName ? `（${instance.partyName}）` : ""}${received ? " 已收，等內部覆核。" : " 欠當前安全及人手覆核版本。"}`,
        `/documents?caseId=${case_.id}`,
      );
    }
    const link = requirement.evidenceLinks?.find((link) => link.documentId === document?.id);
    return {
      requirement: instance,
      version: document?.version ?? null,
      pageFrom: link?.pageFrom ?? null,
      pageTo: link?.pageTo ?? null,
      decision:
        waived && requirement.authorizedBy && requirement.decisionAt && instance.applicabilityReason
          ? {
              decidedByUserId: requirement.authorizedBy,
              decision: "authorized-not-applicable",
              decidedAt: requirement.decisionAt,
              reason: instance.applicabilityReason,
            }
          : document?.reviewedBy && document.reviewedAt
            ? {
                decidedByUserId: document.reviewedBy,
                decision: "approve",
                decidedAt: document.reviewedAt,
                reason: null,
              }
            : null,
      findings: input.findings.filter(
        (finding) =>
          (finding.finding.citation.kind === "requirement" &&
            finding.finding.citation.requirementInstanceId === instance.id) ||
          (finding.finding.citation.kind === "version" &&
            finding.finding.citation.documentVersionId === document?.version?.id),
      ),
    };
  });
  const templateVersions = [
    ...new Set(input.requirements.map((requirement) => requirement.templateVersion)),
  ].sort();
  const manifest = buildPackageManifest({
    caseId: case_.id,
    returnYear: case_.returnYear,
    requirementTemplateVersion: templateVersions.join("+"),
    entries: candidates,
  });
  if (manifest.kind === "blocked")
    for (const blocker of manifest.blockers)
      add(
        blocker.kind,
        "approval",
        `${blocker.requirement}：${
          {
            "requirement-outstanding": "未有可用證據，請核對來源。",
            "evidence-unverifiable": "尚未核實儲存內容。",
            "evidence-superseded": "已被新版取代，請重新覆核。",
            "missing-human-decision": "待人手覆核當前版本。",
            "decision-not-approval": "覆核尚未批准。",
            "unresolved-critical-finding": "重要核對問題尚未處理。",
          }[blocker.kind]
        }`,
        `/documents?caseId=${case_.id}`,
      );
  const proof = documents.get(case_.payment?.paymentProofDocumentId ?? "");
  const citedVersionIds = new Set(
    [
      ...candidates.map((entry) => entry.version?.id),
      proof?.version?.id,
      ...case_.checklist.map((item) => documents.get(item.documentId ?? "")?.version?.id),
    ].filter((id): id is string => Boolean(id)),
  );
  for (const finding of input.findings) {
    if (
      !finding.resolvedByUserId &&
      blocksRelease(finding.finding) &&
      finding.finding.citation.kind === "version" &&
      citedVersionIds.has(finding.finding.citation.documentVersionId)
    )
      add(
        "unresolved_critical_finding",
        "prepare",
        "當前文件／付款證據仍有未處理的重要核對問題。",
        `/documents?caseId=${case_.id}`,
      );
  }
  const manifestPayload =
    manifest.kind === "releasable" && input.requirements.length
      ? JSON.stringify({
          manifest: JSON.parse(canonicalManifestPayload(manifest.manifest)),
          caseEvidence: {
            companyId: case_.companyId,
            madeUpDate: case_.madeUpDate,
            filingDueDate: case_.filingDueDate,
          },
          paymentEvidence: case_.payment
            ? {
                id: case_.payment.id,
                status: case_.payment.status,
                amount: case_.payment.amount,
                receivedAmount: case_.payment.receivedAmount,
                receipts:
                  case_.payment.evidenceEntries
                    ?.filter((e) => e.status === "verified")
                    .map((e) => ({
                      id: e.id,
                      proofVersionId: e.proofVersionId,
                      amount: e.amount,
                      receivedOn: e.receivedOn,
                      reviewedBy: e.reviewedBy,
                      reviewedAt: e.reviewedAt,
                    })) ?? [],
                paidAt: case_.payment.paidAt,
                proofDocumentId: case_.payment.paymentProofDocumentId,
                proofVersionId: proof?.version?.id ?? null,
                verifiedChecksum: proof?.version?.verifiedChecksum ?? null,
              }
            : null,
        })
      : null;
  if (!input.approvedPayload)
    add("package_not_approved", "transmit", "套件尚未由人手批准當前版本。");
  else if (!manifestPayload || input.approvedPayload !== manifestPayload)
    add("package_approval_stale", "transmit", "文件或需求已更新，舊套件批准不適用，請重新覆核。");
  if (!input.destinationConfigured)
    add("destination_unavailable", "transmit", "外部交件連接未驗證；下載或準備套件不等於交件。");
  const readyToPrepare = !blockers.some((blocker) => blocker.stage === "prepare");
  const readyForApproval =
    readyToPrepare && !blockers.some((blocker) => blocker.stage === "approval");
  return {
    sourceVersion: input.sourceVersion,
    readyToPrepare,
    readyForApproval,
    readyToTransmit: readyForApproval && !blockers.some((blocker) => blocker.stage === "transmit"),
    blockers,
    manifestPayload,
  };
}

export function readinessForCase(case_: AnnualReturnCase): ReadinessSnapshot {
  return (
    case_.readiness ?? {
      sourceVersion: null,
      readyToPrepare: false,
      readyForApproval: false,
      readyToTransmit: false,
      manifestPayload: null,
      blockers: [
        {
          code: "readiness_unknown",
          stage: "prepare",
          message: "未取得當前付款、文件版本及適用性證據，請刷新案件。",
          action: `/annual-returns/${case_.id}`,
        },
      ],
    }
  );
}

export class ReadinessConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super(
      "Case evidence changed or current preview is missing. Refresh before approval/preparation.",
    );
  }
}
