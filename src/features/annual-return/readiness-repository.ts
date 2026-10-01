import type postgres from "postgres";
import { creditedPaymentEvidenceSql, type PaymentEvidenceEntry } from "./payment-evidence-state";
import { createHash } from "node:crypto";
import type { SqlClient } from "@/server/db/client";
import type { DocumentStatus, ScanVerdictSource } from "@/features/documents/types";
import type { Finding, FindingCitation } from "@/features/documents/findings";
import { buildRequirementInstances, checklistLookupFor } from "./requirement-template";
import { computeReadiness, type ReadinessDocument, type ReadinessRequirement } from "./readiness";
import type { AnnualReturnCase, AnnualReturnChecklistItem, AnnualReturnPayment } from "./types";
import type { RequirementApplicability } from "./requirements";

type Query = SqlClient | postgres.TransactionSql;
type Checklist = {
  id: string;
  case_id: string;
  item_label: string;
  required: boolean;
  status: AnnualReturnChecklistItem["status"];
  due_date: string;
  received_at: string | null;
  verified_at: string | null;
  document_id: string | null;
};
type Payment = {
  credited_amount: string;
  id: string;
  case_id: string;
  invoice_number: string;
  amount: number;
  currency: "HKD";
  status: AnnualReturnPayment["status"];
  due_date: string;
  paid_at: string | null;
  payment_proof_document_id: string | null;
};
type Document = {
  id: string;
  company_id: string;
  case_id: string | null;
  file_type: string;
  verification_status: ReadinessDocument["reviewStatus"];
  verified_by: string | null;
  verified_at: string | null;
  source_matches: boolean;
  version: null | {
    id: string;
    document_id: string;
    version_number: number;
    declared_checksum_sha256: string | null;
    verified_checksum_sha256: string | null;
    superseded_by_version_id: string | null;
    created_at: string;
  };
  intent: null | { status: DocumentStatus; scan_verdict_source: ScanVerdictSource | null };
};
type Requirement = {
  id: string;
  checklist_item_id: string;
  party_id: string | null;
  requirement_key: string;
  template_version: string;
  applicability: RequirementApplicability;
  applicability_reason: string | null;
  authorized_by: string | null;
  updated_at: string;
  links: { document_id: string; page_from: number | null; page_to: number | null }[];
};
type Party = {
  id: string;
  officer_id: string | null;
  party_type: import("./requirement-template").PartyType;
  display_name: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  active: boolean;
};
type Snapshot = {
  payment_evidence: {
    id: string;
    payment_id: string;
    document_id: string;
    proof_version_id: string;
    amount: string;
    received_on: string;
    reference: string | null;
    status: PaymentEvidenceEntry["status"];
    reason_code: string | null;
    reason_text: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
  }[];
  case: {
    id: string;
    company_id: string;
    made_up_date: string;
    filing_due_date: string;
    return_year: number;
    owner_id: string;
    reviewer_id: string | null;
    current_status: AnnualReturnCase["currentStatus"];
    locked_at: string | null;
    completed_at: string | null;
  };
  company: {
    company_name: string;
    assigned_team_id: string;
    data_origin: AnnualReturnCase["dataOrigin"];
  };
  checklist: Checklist[];
  payments: Payment[];
  documents: Document[];
  requirements: Requirement[];
  parties: Party[];
  officer_ids: string[];
  approvals: { status: string; manifest_payload: string; manifest_sha256: string }[];
  findings: {
    id: string;
    document_version_id: string | null;
    requirement_instance_id: string | null;
    page_from: number | null;
    page_to: number | null;
    tier: Finding["tier"];
    rule_key: string;
    rule_version: string;
    outcome: Finding["outcome"];
    severity: Finding["severity"];
    detail: string;
    resolved_by: string | null;
    resolved_at: string | null;
  }[];
};

/** One statement observes all evidence and its change token at the same MVCC snapshot. */
export async function attachCaseReadiness(
  sql: Query,
  cases: AnnualReturnCase[],
): Promise<AnnualReturnCase[]> {
  if (!cases.length) return cases;
  const rows = await sql<{ payload: Snapshot; source_version: string }[]>`
    with snapshots as (
      select jsonb_build_object(
        'case',to_jsonb(arc),'company',to_jsonb(c),
        'checklist',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from annual_return_checklist_items x where x.case_id=arc.id),'[]'::jsonb),
        'payments',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('credited_amount',(select coalesce(sum(e.amount),0)::text from payments p join payment_evidence_entries e on e.payment_id=p.id join documents d on d.id=e.document_id join document_versions v on v.id=e.proof_version_id join document_upload_intents i on i.id=v.intent_id where p.id=x.id and ${creditedPaymentEvidenceSql(sql)})) order by x.id) from payments x where x.case_id=arc.id),'[]'::jsonb),
        'payment_evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.recorded_at,e.id) from payment_evidence_entries e where e.case_id=arc.id),'[]'::jsonb),
        'documents',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('version',to_jsonb(v),'intent',to_jsonb(i),
          'source_matches',coalesce(v.storage_url=d.storage_url and i.document_id=d.id and i.company_id=d.company_id and i.case_id is not distinct from d.case_id and v.storage_url=i.object_key and v.declared_checksum_sha256=i.checksum_sha256 and v.verified_byte_size>0,false)) order by d.id)
          from documents d left join document_versions v on v.document_id=d.id and v.superseded_by_version_id is null
          left join document_upload_intents i on i.id=v.intent_id
          where d.company_id=arc.company_id and (d.case_id=arc.id or (d.case_id is null and (
            d.id in(select document_id from annual_return_checklist_items where case_id=arc.id)
            or d.id in(select payment_proof_document_id from payments where case_id=arc.id)
            or d.id in(select l.document_id from requirement_evidence_links l join case_requirement_instances r on r.id=l.requirement_instance_id where r.case_id=arc.id))))),'[]'::jsonb),
        'requirements',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('links',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from requirement_evidence_links l where l.requirement_instance_id=r.id),'[]'::jsonb)) order by r.id) from case_requirement_instances r where r.case_id=arc.id),'[]'::jsonb),
        'parties',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from case_parties p where p.case_id=arc.id),'[]'::jsonb),
        'officer_ids',coalesce((select jsonb_agg(o.id order by o.id) from officers o where o.company_id=arc.company_id and o.cessation_date is null),'[]'::jsonb),
        'approvals',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id) from package_handoffs h where h.case_id=arc.id),'[]'::jsonb),
        'findings',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from document_findings f where
          f.requirement_instance_id in(select id from case_requirement_instances where case_id=arc.id)
          or f.document_version_id in(select v.id from document_versions v join documents d on d.id=v.document_id where d.company_id=arc.company_id and (d.case_id=arc.id or d.id in(select payment_proof_document_id from payments where case_id=arc.id)))),'[]'::jsonb)
      ) payload from annual_return_cases arc join companies c on c.id=arc.company_id where arc.id=any(${cases.map((case_) => case_.id)}::uuid[])
    ) select payload,md5(payload::text) source_version from snapshots`;
  const byId = new Map(rows.map((row) => [row.payload.case.id, row]));
  return cases.map((base) => {
    const row = byId.get(base.id);
    if (!row) return base;
    const payload = row.payload;
    const payment = payload.payments.length === 1 ? payload.payments[0] : null;
    const case_: AnnualReturnCase = {
      ...base,
      companyId: payload.case.company_id,
      companyName: payload.company.company_name,
      companyTeamId: payload.company.assigned_team_id,
      dataOrigin: payload.company.data_origin,
      madeUpDate: payload.case.made_up_date,
      filingDueDate: payload.case.filing_due_date,
      returnYear: payload.case.return_year,
      ownerId: payload.case.owner_id,
      reviewerId: payload.case.reviewer_id,
      currentStatus: payload.case.current_status,
      lockedAt: payload.case.locked_at,
      completedAt: payload.case.completed_at,
      checklist: payload.checklist.map((item) => ({
        id: item.id,
        caseId: item.case_id,
        itemLabel: item.item_label,
        required: item.required,
        status: item.status,
        dueDate: item.due_date,
        receivedAt: item.received_at,
        verifiedAt: item.verified_at,
        documentId: item.document_id,
      })),
      payment: payment
        ? {
            id: payment.id,
            caseId: payment.case_id,
            invoiceNumber: payment.invoice_number,
            amount: Number(payment.amount),
            receivedAmount: Number(payment.credited_amount),
            balance: Math.max(0, Number(payment.amount) - Number(payment.credited_amount)),
            evidenceEntries: payload.payment_evidence
              .filter((e) => e.payment_id === payment.id)
              .map((e) => ({
                id: e.id,
                paymentId: e.payment_id,
                documentId: e.document_id,
                proofVersionId: e.proof_version_id,
                amount: Number(e.amount),
                receivedOn: e.received_on,
                reference: e.reference,
                status: e.status,
                reasonCode: e.reason_code,
                reasonText: e.reason_text,
                reviewedBy: e.reviewed_by,
                reviewedAt: e.reviewed_at,
              })),
            currency: payment.currency,
            status: payment.status,
            dueDate: payment.due_date,
            paidAt: payment.paid_at,
            paymentProofDocumentId: payment.payment_proof_document_id,
          }
        : null,
    };
    const requirements: ReadinessRequirement[] = payload.requirements.map((r) => ({
      instance: {
        id: r.id,
        checklistItemId: r.checklist_item_id,
        partyId: r.party_id,
        partyName: payload.parties.find((p) => p.id === r.party_id)?.display_name ?? null,
        requirementKey: r.requirement_key,
        applicability: r.applicability,
        applicabilityReason: r.applicability_reason,
        evidence: [],
      },
      templateVersion: r.template_version,
      authorizedBy: r.authorized_by,
      decisionAt: r.updated_at,
      documentIds: r.links.map((l) => l.document_id),
      evidenceLinks: r.links.map((l) => ({
        documentId: l.document_id,
        pageFrom: l.page_from,
        pageTo: l.page_to,
      })),
    }));
    const parties = payload.parties.map((p) => ({
      id: p.id,
      partyType: p.party_type,
      displayName: p.display_name,
      active: p.active,
      confirmed: Boolean(p.confirmed_by && p.confirmed_at),
    }));
    const expected = buildRequirementInstances({
      parties,
      checklistItemIdFor: checklistLookupFor(case_.checklist).checklistItemIdFor,
      referenceDate: case_.madeUpDate,
    });
    const partiesKnown =
      parties.some((party) => party.active && party.confirmed) &&
      !expected.awaitingPartyConfirmation &&
      payload.officer_ids.every((id) =>
        payload.parties.some(
          (p) => p.officer_id === id && p.active && p.confirmed_by && p.confirmed_at,
        ),
      ) &&
      expected.drafts.every((draft) =>
        payload.requirements.some(
          (r) =>
            r.checklist_item_id === draft.checklistItemId &&
            r.party_id === draft.partyId &&
            r.requirement_key === draft.requirementKey,
        ),
      );
    const documents: ReadinessDocument[] = payload.documents.map((d) => ({
      id: d.id,
      companyId: d.company_id,
      caseId: d.case_id,
      category: d.file_type,
      reviewStatus: d.verification_status,
      reviewedBy: d.verified_by,
      reviewedAt: d.verified_at,
      versionCreatedAt: d.version?.created_at ?? null,
      currentSourceMatches: d.source_matches,
      uploadStatus: d.intent?.status ?? null,
      scanVerdictSource: d.intent?.scan_verdict_source ?? null,
      version: d.version
        ? {
            id: d.version.id,
            documentId: d.version.document_id,
            versionNumber: d.version.version_number,
            declaredChecksum: d.version.declared_checksum_sha256,
            verifiedChecksum: d.version.verified_checksum_sha256,
            supersededByVersionId: d.version.superseded_by_version_id,
          }
        : null,
    }));
    const findings = payload.findings.map((f) => ({
      id: f.id,
      resolvedByUserId: f.resolved_by,
      resolvedAt: f.resolved_at,
      finding: {
        ruleKey: f.rule_key,
        ruleVersion: f.rule_version,
        tier: f.tier,
        outcome: f.outcome,
        severity: f.severity,
        detail: f.detail,
        citation: (f.document_version_id
          ? {
              kind: "version",
              documentVersionId: f.document_version_id,
              pageFrom: f.page_from,
              pageTo: f.page_to,
            }
          : f.requirement_instance_id
            ? { kind: "requirement", requirementInstanceId: f.requirement_instance_id }
            : { kind: "none" }) as FindingCitation,
      },
    }));
    const approval = payload.approvals.find((h) => h.status === "prepared");
    const approvedPayload =
      approval &&
      createHash("sha256").update(approval.manifest_payload).digest("hex") ===
        approval.manifest_sha256
        ? approval.manifest_payload
        : null;
    case_.readiness = computeReadiness({
      case_,
      sourceVersion: row.source_version,
      partiesKnown,
      documents,
      requirements,
      findings,
      approvedPayload,
      destinationConfigured: false,
    });
    return case_;
  });
}
