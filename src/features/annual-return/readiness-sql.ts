import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import { ANNUAL_RETURN_REQUIREMENTS, REQUIREMENT_MARKERS } from "./requirement-template";
import { creditedPaymentEvidenceSql } from "./payment-evidence-state";
type Query = SqlClient | postgres.TransactionSql;

/** SQL read eligibility mirrors computeReadiness. Commands still recheck canonical domain evidence under locks. */
function usableDocument(sql: Query, id: postgres.Fragment) {
  return sql`select d.id,v.id version_id from documents d
    join document_versions v on v.document_id=d.id and v.superseded_by_version_id is null
    join document_upload_intents i on i.id=v.intent_id
    where d.id=${id} and d.company_id=arc.company_id and (d.case_id=arc.id or d.case_id is null)
      and d.verification_status='verified' and d.reviewed_document_version_id=v.id
      and d.verified_by is not null and d.verified_at is not null and d.verified_at>=v.created_at
      and v.verified_checksum_sha256 is not null and v.verified_checksum_sha256<>''
      and v.declared_checksum_sha256=v.verified_checksum_sha256 and v.verified_byte_size>0
      and v.storage_url=d.storage_url and i.object_key=v.storage_url
      and i.document_id=d.id and i.company_id=d.company_id and i.case_id is not distinct from d.case_id
      and i.checksum_sha256=v.declared_checksum_sha256 and i.scan_document_version_id=v.id
      and i.status='available' and i.scan_verdict_source='provider'`;
}
function chosenVersion(sql: Query) {
  return sql`select usable.version_id from requirement_evidence_links l
    join lateral (${usableDocument(sql, sql`l.document_id`)}) usable on true
    where l.requirement_instance_id=r.id order by l.id limit 1`;
}
function matchingKey(sql: Query) {
  return sql`select min(m->>'key') from jsonb_array_elements(${sql.json(REQUIREMENT_MARKERS as unknown as postgres.JSONValue)}::jsonb)m
    where exists(select 1 from jsonb_array_elements_text(m->'markers') marker where strpos(lower(ci.item_label),marker)>0)
    having count(*)=1`;
}
export function readyForApprovalSql(sql: Query) {
  const rules = ANNUAL_RETURN_REQUIREMENTS.map((r) => ({
    key: r.key,
    types: r.scope.kind === "company" ? null : r.scope.partyTypes,
  }));
  return sql`(
    arc.current_status not in ('Filed','Completed') and arc.locked_at is null and arc.completed_at is null
    and exists(select 1 from annual_return_checklist_items where case_id=arc.id)
    and exists(select 1 from case_requirement_instances where case_id=arc.id)
    and exists(select 1 from case_parties where case_id=arc.id and active and confirmed_by is not null and confirmed_at is not null)
    and not exists(select 1 from case_parties where case_id=arc.id and active and (confirmed_by is null or confirmed_at is null))
    and not exists(select 1 from officers o where o.company_id=arc.company_id and o.cessation_date is null
      and not exists(select 1 from case_parties p where p.case_id=arc.id and p.officer_id=o.id and p.active and p.confirmed_by is not null and p.confirmed_at is not null))
    and not exists(
      select 1 from annual_return_checklist_items ci
      join lateral (${matchingKey(sql)}) matched(key) on true
      join jsonb_array_elements(${sql.json(rules)}::jsonb) rule on rule->>'key'=matched.key
      where ci.case_id=arc.id and ci.id=(select ci2.id from annual_return_checklist_items ci2
        where ci2.case_id=arc.id and ci2.id in(select ci3.id from annual_return_checklist_items ci3
          join lateral (select min(m->>'key') key from jsonb_array_elements(${sql.json(REQUIREMENT_MARKERS as unknown as postgres.JSONValue)}::jsonb)m
            where exists(select 1 from jsonb_array_elements_text(m->'markers') marker where strpos(lower(ci3.item_label),marker)>0) having count(*)=1) k on k.key=matched.key)
        order by ci2.id limit 1)
        and ((rule->'types'='null'::jsonb and not exists(select 1 from case_requirement_instances r where r.case_id=arc.id and r.checklist_item_id=ci.id and r.party_id is null and r.requirement_key=matched.key))
          or (rule->'types'<>'null'::jsonb and exists(select 1 from case_parties p where p.case_id=arc.id and p.active and p.confirmed_by is not null and p.confirmed_at is not null and rule->'types' ? p.party_type
            and not exists(select 1 from case_requirement_instances r where r.case_id=arc.id and r.checklist_item_id=ci.id and r.party_id=p.id and r.requirement_key=matched.key))))
    )
    and not exists(select 1 from annual_return_checklist_items ci where ci.case_id=arc.id and ci.required
      and not ((exists(select 1 from case_requirement_instances r where r.checklist_item_id=ci.id and r.case_id=arc.id)
        and not exists(select 1 from case_requirement_instances r where r.checklist_item_id=ci.id and r.case_id=arc.id
          and (r.applicability='required' or r.authorized_by is null or r.updated_at is null or nullif(btrim(r.applicability_reason),'') is null)))
        or (ci.status='Verified' and ci.received_at is not null and ci.verified_at is not null and exists(${usableDocument(sql, sql`ci.document_id`)})
          and exists(select 1 from case_requirement_instances r where r.case_id=arc.id and r.checklist_item_id=ci.id))))
    and exists(select 1 from payments p where p.id=(select id from payments where case_id=arc.id order by id limit 1)
      and p.status='Payment received' and p.paid_at is not null and p.amount>0
      and (select coalesce(sum(e.amount),0) from payment_evidence_entries e
        join documents d on d.id=e.document_id join document_versions v on v.id=e.proof_version_id join document_upload_intents i on i.id=v.intent_id
        where e.payment_id=p.id and ${creditedPaymentEvidenceSql(sql)})>=p.amount
      and exists(select 1 from documents proof where proof.id=p.payment_proof_document_id and proof.file_type='payment')
      and exists(${usableDocument(sql, sql`p.payment_proof_document_id`)}))
    and not exists(select 1 from case_requirement_instances r where r.case_id=arc.id and (
      (r.applicability<>'required' and (r.authorized_by is null or r.updated_at is null or nullif(btrim(r.applicability_reason),'') is null))
      or (r.applicability='required' and (${chosenVersion(sql)}) is null)
      or exists(select 1 from document_findings f where f.resolved_by is null and f.outcome='issue' and f.severity='critical'
        and (f.requirement_instance_id=r.id or f.document_version_id=(${chosenVersion(sql)})))
    ))
    and not exists(select 1 from document_findings f join document_versions v on v.id=f.document_version_id
      join documents d on d.id=v.document_id where f.resolved_by is null and f.outcome='issue' and f.severity='critical'
      and v.superseded_by_version_id is null and d.company_id=arc.company_id and (d.case_id=arc.id or d.case_id is null)
      and (d.id in(select document_id from annual_return_checklist_items where case_id=arc.id)
        or d.id=(select payment_proof_document_id from payments where case_id=arc.id order by id limit 1)))
  )`;
}
