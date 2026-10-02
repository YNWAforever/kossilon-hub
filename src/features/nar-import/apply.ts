import type postgres from "postgres";
import type { z } from "zod";
import { jobHistorySchema } from "@/features/bulk-operations/types";
import {
  narPreviewSchema,
  narYearConfirmationSchema,
  narExecuteSchema,
  type NarRowInputs,
  type NarPreviewItem,
  type CaseValue,
} from "./apply-contracts";
export type { NarRowInputs, NarPreviewItem } from "./apply-contracts";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import { calculateFilingDueDate } from "@/features/annual-return/workflow";
import { hongKongBusinessDate } from "@/lib/hong-kong-time";
import { requireCurrentNarAdmin } from "./authorization";
import type { JsonValue } from "./repository";
import type { RowIssue } from "./mapping";
type Tx = postgres.TransactionSql;
type Context = {
  batch: {
    id: string;
    source_system: string;
    source_sha256: string;
    parser_version: string;
    return_year: number | null;
    sheet_name: string;
  };
  row: {
    id: string;
    batch_id: string;
    external_client_id: string;
    raw: JsonValue;
    parsed: {
      invoice: { kind: string; raw: string };
      arDue: { iso?: string };
      paymentReceived: JsonValue;
    };
    issues: RowIssue[];
    applied_case_id: string | null;
    applied_at: string | null;
    [key: string]: JsonValue;
  };
  reference: { company_id: string; mapped_by: string | null; [key: string]: JsonValue } | null;
  company: { id: string; status: string; data_origin: string; [key: string]: JsonValue } | null;
  case: CaseValue | null;
  checklist: JsonValue[];
  payments: JsonValue[];
  work: JsonValue[];
  template:
    | ({ id: string; active: boolean; service_type: string } & Record<string, JsonValue>)
    | null;
  owner: {
    user: { role: string; active: boolean; team_id: string | null };
    profile: { role: string; active: boolean; team_id: string | null };
  } | null;
  parties: JsonValue[];
  requirements: JsonValue[];
  handoffs: JsonValue[];
  progress: boolean;
};
function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}
async function hash(value: unknown) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value))),
  );
  return [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
}
async function context(
  tx: Tx,
  batchId: string,
  rowId: string,
  input: NarRowInputs,
  lock = false,
): Promise<Context> {
  const [batch] = await tx<
    Context["batch"][]
  >`select id,source_system,source_sha256,parser_version,return_year,sheet_name from nar_import_batches where id=${batchId} ${lock ? tx`for update` : tx``}`;
  if (!batch) throw new Error("Import batch not found.");
  const [row] = await tx<
    Context["row"][]
  >`select * from nar_import_rows where id=${rowId} and batch_id=${batchId} ${lock ? tx`for update` : tx``}`;
  if (!row) throw new Error("Import row does not belong to this batch.");
  if (lock)
    await tx`select pg_advisory_xact_lock(hashtextextended(${batch.source_system + ":" + row.external_client_id},0))`;
  const [reference] = await tx<
    NonNullable<Context["reference"]>[]
  >`select * from company_external_references where source_system=${batch.source_system} and external_client_id=${row.external_client_id} ${lock ? tx`for share` : tx``}`;
  const [company] = reference
    ? await tx<
        NonNullable<Context["company"]>[]
      >`select * from companies where id=${reference.company_id} ${lock ? tx`for update` : tx``}`
    : [];
  const [case_] =
    company && batch.return_year
      ? await tx<
          CaseValue[]
        >`select a.*,a.filing_due_date::text filing_due_date,a.made_up_date::text made_up_date from annual_return_cases a where company_id=${company.id} and return_year=${batch.return_year} ${lock ? tx`for update` : tx``}`
      : [];
  // Parent case/company locks are already held. Independent child/target reads
  // share this transaction; pipelining removes avoidable per-query network waits.
  const [
    checklist,
    payments,
    work,
    parties,
    requirements,
    handoffs,
    progressRows,
    templateRows,
    ownerRows,
  ] = await Promise.all([
    case_
      ? tx`select to_jsonb(i) value from annual_return_checklist_items i where case_id=${case_.id} order by id ${lock ? tx`for update` : tx``}`
      : Promise.resolve([]),
    case_
      ? tx`select to_jsonb(p) value from payments p where case_id=${case_.id} order by id ${lock ? tx`for update` : tx``}`
      : Promise.resolve([]),
    case_
      ? tx`select to_jsonb(w) value from work_items w where annual_return_case_id=${case_.id} order by id ${lock ? tx`for update` : tx``}`
      : Promise.resolve([]),
    case_
      ? tx`select to_jsonb(p) value from case_parties p where case_id=${case_.id} order by id ${lock ? tx`for update` : tx``}`
      : Promise.resolve([]),
    case_
      ? tx`select to_jsonb(q) value from case_requirement_instances q where case_id=${case_.id} order by id ${lock ? tx`for update` : tx``}`
      : Promise.resolve([]),
    case_
      ? tx`select to_jsonb(h) value from package_handoffs h where case_id=${case_.id} order by id ${lock ? tx`for update` : tx``}`
      : Promise.resolve([]),
    case_
      ? tx`select (exists(select 1 from documents where case_id=${case_.id}) or exists(select 1 from annual_return_checklist_items where case_id=${case_.id} and status<>'Missing') or exists(select 1 from payments where case_id=${case_.id} and (paid_at is not null or payment_proof_document_id is not null or status='Payment received')) or exists(select 1 from work_items where annual_return_case_id=${case_.id} and (version>1 or status<>'open'))) touched`
      : Promise.resolve([]),
    input.templateId
      ? tx`select to_jsonb(t) value from checklist_templates t where id=${input.templateId} ${lock ? tx`for share` : tx``}`
      : Promise.resolve([]),
    input.ownerId
      ? tx`select jsonb_build_object('user',to_jsonb(u),'profile',to_jsonb(sp)) value from users u join staff_profiles sp on sp.user_id=u.id where u.id=${input.ownerId} ${lock ? tx`for share of u,sp` : tx``}`
      : Promise.resolve([]),
  ]);
  const [progress] = progressRows,
    [template] = templateRows,
    [owner] = ownerRows;
  // JSON serialization normalizes driver Date objects identically for saved and current versions.
  return JSON.parse(
    JSON.stringify({
      batch,
      row,
      reference: reference ?? null,
      company: company ?? null,
      case: case_ ?? null,
      checklist: checklist.map((r) => r.value),
      payments: payments.map((r) => r.value),
      work: work.map((r) => r.value),
      template: template?.value ?? null,
      owner: owner?.value ?? null,
      parties: parties.map((r) => r.value),
      requirements: requirements.map((r) => r.value),
      handoffs: handoffs.map((r) => r.value),
      progress:
        Boolean(progress?.touched) ||
        parties.length > 0 ||
        requirements.length > 0 ||
        handoffs.length > 0,
    }),
  ) as Context;
}
async function itemFor(
  c: Context,
  input: NarRowInputs,
  origin: "historical" | "client",
  activate: boolean,
): Promise<NarPreviewItem> {
  const requiredInputs: string[] = [],
    conflicts: string[] = [];
  const due = c.row.parsed.arDue.iso ?? null;
  const madeUp = input.madeUpDate ?? c.case?.made_up_date ?? null;
  const payment =
    c.payments.length === 1 &&
    typeof c.payments[0] === "object" &&
    c.payments[0] !== null &&
    !Array.isArray(c.payments[0])
      ? c.payments[0]
      : null;
  const existingFee = typeof payment?.amount === "number" ? payment.amount : null;
  const existingInvoice =
    typeof payment?.invoice_number === "string" ? payment.invoice_number : null;
  const invoice = c.case
    ? existingInvoice
    : (input.invoiceNumber ??
      (c.row.parsed.invoice.kind === "value" ? c.row.parsed.invoice.raw : null));
  const fee = c.case ? existingFee : (input.feeAmount ?? null);
  if (
    c.case &&
    ((input.feeAmount !== undefined && input.feeAmount !== existingFee) ||
      (input.invoiceNumber !== undefined && input.invoiceNumber !== existingInvoice))
  )
    conflicts.push("existing_invoice_or_fee_change_requires_separate_review");
  const sourceInvoiceDifference =
    c.case && c.row.parsed.invoice.kind === "value" && c.row.parsed.invoice.raw !== existingInvoice
      ? { source: c.row.parsed.invoice.raw, existing: existingInvoice }
      : null;
  if (sourceInvoiceDifference) conflicts.push("source_invoice_change_requires_separate_review");
  if (c.case && !payment) requiredInputs.push("existingPaymentRecord");
  if (c.case && input.ownerId !== undefined && input.ownerId !== c.case.owner_id)
    conflicts.push("assignment_requires_separate_command");
  if (c.row.applied_at && c.row.applied_case_id !== c.case?.id)
    conflicts.push("applied_row_mapping_conflict");
  if (c.batch.return_year === null) requiredInputs.push("confirmedReturnYear");
  if (!c.reference || !c.reference.mapped_by || !c.company)
    requiredInputs.push("confirmedCompanyMapping");
  if (c.company && c.company.status !== "active") conflicts.push("company_inactive");
  if (c.row.issues.some((i) => i.severity === "blocking")) conflicts.push("source_row_invalid");
  if (!due) requiredInputs.push("sourceFilingDueDate");
  if (
    !c.case &&
    input.templateId &&
    (!c.template?.active || !c.template.service_type.startsWith("Annual Return"))
  )
    conflicts.push("template_ineligible");
  if (
    !c.case &&
    input.ownerId &&
    (!c.owner?.user.active ||
      !c.owner.profile.active ||
      !["Admin", "Manager", "Staff"].includes(c.owner.user.role) ||
      c.owner.profile.role !== c.owner.user.role ||
      c.owner.user.team_id !== c.owner.profile.team_id)
  )
    conflicts.push("owner_ineligible");
  if (!c.case) {
    for (const k of ["templateId", "ownerId", "feeAmount"] as const)
      if (input[k] === undefined) requiredInputs.push(k);
    if (!madeUp) requiredInputs.push("madeUpDate");
    if (!invoice) requiredInputs.push("invoiceNumber");
  }
  if (madeUp && due && due < madeUp) conflicts.push("filing_due_before_made_up");
  if (madeUp && c.batch.return_year !== Number(madeUp.slice(0, 4)))
    conflicts.push("made_up_year_mismatch");
  if (madeUp && due && calculateFilingDueDate(madeUp) !== due && !input.acknowledgeDueDifference)
    requiredInputs.push("acknowledgeDueDifference");
  const observed = /^(?:\d{1,2}\.)(\d{4})$/.exec(c.batch.sheet_name)?.[1];
  if (observed && Number(observed) !== c.batch.return_year && !input.acknowledgeYearDifference)
    requiredInputs.push("acknowledgeYearDifference");
  if (c.row.issues.some((i) => i.severity === "attention") && !input.acknowledgeSourceIssues)
    requiredInputs.push("acknowledgeSourceIssues");
  if (
    origin === "client" &&
    (!activate || c.batch.return_year !== Number(hongKongBusinessDate().slice(0, 4)))
  )
    conflicts.push("current_year_activation_required");
  const effectiveOrigin =
    c.company?.data_origin === "client"
      ? (c.case?.import_origin ?? "client")
      : c.company?.data_origin;
  if (c.case && effectiveOrigin !== origin) conflicts.push("existing_case_origin_mismatch");
  if (origin === "client" && c.company?.data_origin !== "client")
    conflicts.push("non_client_company");
  const command = c.row.applied_at
    ? "already_applied"
    : !c.case
      ? "create"
      : c.case.filing_due_date === due
        ? "unchanged"
        : "update";
  if (
    command === "update" &&
    c.case &&
    (c.progress ||
      c.case.current_status !== "Upcoming" ||
      c.case.locked_at ||
      c.case.completed_at ||
      c.case.reminders_sent > 0 ||
      c.case.filing_reference)
  )
    conflicts.push("staff_progress_conflict");
  if (c.case && input.madeUpDate && input.madeUpDate !== c.case.made_up_date)
    conflicts.push("existing_made_up_date_mismatch");
  const candidate = {
    companyId: c.company?.id ?? null,
    returnYear: c.batch.return_year,
    madeUpDate: madeUp,
    filingDueDate: due,
    invoiceNumber: invoice,
    feeAmount: fee,
  };
  const before = {
    companyId: c.case?.company_id ?? null,
    returnYear: c.case?.return_year ?? null,
    madeUpDate: c.case?.made_up_date ?? null,
    filingDueDate: c.case?.filing_due_date ?? null,
    invoiceNumber: existingInvoice,
    feeAmount: existingFee,
  };
  const diff = (Object.keys(candidate) as (keyof typeof candidate)[])
    .filter((field) => before[field] !== candidate[field])
    .map((field) => ({ field, before: before[field], after: candidate[field] }));
  return {
    rowId: c.row.id,
    revision: await hash(c),
    dataOrigin: origin,
    input,
    original: c.case,
    candidate,
    diff,
    sourceInvoiceDifference,
    requiredInputs: [...new Set(requiredInputs)],
    conflicts: [...new Set(conflicts)],
    command,
    raw: c.row.raw,
    parserVersion: c.batch.parser_version,
  };
}
/** The single row domain command is also the bulk worker's only domain write path. */
export async function applyNarRow(
  tx: Tx,
  actor: AuthenticatedActor,
  c: Context,
  item: NarPreviewItem,
) {
  await requireCurrentNarAdmin(tx, actor, true);
  const target = item.candidate;
  if (!target.companyId || !target.returnYear || !target.madeUpDate || !target.filingDueDate)
    throw new Error("Import required values are absent.");
  if (item.command === "already_applied") return c.row.applied_case_id!;
  if (item.command === "create") {
    const case_ = await createAnnualReturnRepository({ sql: tx }).createCaseRecord({
      companyId: target.companyId,
      templateId: item.input.templateId!,
      ownerId: item.input.ownerId!,
      invoiceNumber: target.invoiceNumber!,
      feeAmount: item.input.feeAmount!,
      actorId: actor.userId!,
      importSource: {
        returnYear: target.returnYear,
        madeUpDate: target.madeUpDate,
        filingDueDate: target.filingDueDate,
        dataOrigin: item.dataOrigin,
        batchId: c.batch.id,
        rowId: c.row.id,
      },
    });
    return case_.id;
  }
  if (!c.case) throw new Error("Import existing case disappeared.");
  if (item.command === "update") {
    await tx`update annual_return_cases set filing_due_date=${target.filingDueDate},updated_at=now() where id=${c.case.id}`;
    await tx`update annual_return_checklist_items set due_date=due_date+(${target.filingDueDate}::date-${c.case.filing_due_date}::date),updated_at=now() where case_id=${c.case.id}`;
    await tx`update payments set due_date=${target.filingDueDate},updated_at=now() where case_id=${c.case.id}`;
  }
  await tx`insert into annual_return_audit_events(case_id,company_id,actor_id,actor_role,action,summary,metadata) values(${c.case.id},${target.companyId},${actor.userId!},'Admin','add_note','Reviewed NAR source applied; payment date remains observation.',${tx.json({ command: "apply_import", batchId: c.batch.id, rowId: c.row.id, beforeDue: c.case.filing_due_date, afterDue: target.filingDueDate, sourceSha256: c.batch.source_sha256, parserVersion: c.batch.parser_version })})`;
  return c.case.id;
}
/** Capture every mutated or subsequently referenced fact for compensation review. */
async function domainSnapshot(tx: Tx, caseId: string): Promise<JsonValue> {
  const [r] = await tx<
    { value: JsonValue }[]
  >`select jsonb_build_object('case',to_jsonb(a),'checklist',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from annual_return_checklist_items i where i.case_id=a.id),'[]'::jsonb),'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from payments p where p.case_id=a.id),'[]'::jsonb),'work',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from work_items w where w.annual_return_case_id=a.id),'[]'::jsonb),'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from documents d where d.case_id=a.id),'[]'::jsonb),'handoffs',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from package_handoffs h where h.case_id=a.id),'[]'::jsonb),'parties',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from case_parties p where p.case_id=a.id),'[]'::jsonb),'requirements',coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from case_requirement_instances q where q.case_id=a.id),'[]'::jsonb)) value from annual_return_cases a where a.id=${caseId}`;
  if (!r) throw new Error("Case disappeared during journal capture.");
  return r.value;
}
type Job = {
  id: string;
  batch_id: string;
  actor_user_id: string;
  auth_user_id: string;
  state: string;
  payload_hash: string;
  preview_id: string;
};
async function updateJobState(
  tx: Tx,
  jobId: string,
  pendingState: "queued" | "running" = "running",
) {
  await tx`update nar_apply_jobs set state=case when exists(select 1 from nar_apply_job_items where job_id=${jobId} and state='pending') then ${pendingState} when exists(select 1 from nar_apply_job_items where job_id=${jobId} and state in ('conflict','failed')) then 'partial' else 'completed' end,updated_at=now() where id=${jobId} and state<>'cancelled'`;
}
export function createNarApplyRepository({
  sql = getSqlClient(),
  applyRow = applyNarRow,
}: { sql?: SqlClient; applyRow?: typeof applyNarRow } = {}) {
  async function ownJob(tx: Tx, actor: AuthenticatedActor, id: string, lock = false) {
    await requireCurrentNarAdmin(tx, actor, true);
    const [job] = await tx<
      Job[]
    >`select * from nar_apply_jobs where id=${id} and actor_user_id=${actor.userId!} and auth_user_id=${actor.authUserId} ${lock ? tx`for update` : tx``}`;
    if (!job) throw new Error("Forbidden: own NAR job required.");
    return job;
  }
  return {
    async confirmYear(actor: AuthenticatedActor, raw: z.input<typeof narYearConfirmationSchema>) {
      const input = narYearConfirmationSchema.parse(raw);
      return sql.begin(async (tx) => {
        await requireCurrentNarAdmin(tx, actor, true);
        const [b] = await tx<
          { id: string; return_year: number | null; sheet_name: string; revision: string }[]
        >`select b.*,md5(to_jsonb(b)::text) revision from nar_import_batches b where id=${input.batchId} for update`;
        if (!b) throw new Error("Import batch not found.");
        if (b.return_year !== null) {
          if (b.return_year === input.returnYear) return { confirmed: true as const };
          throw new Error("Confirmed return year is immutable.");
        }
        if (b.revision !== input.expectedVersion)
          throw new Error("Conflict: batch version changed; review again.");
        const [used] =
          await tx`select id from nar_import_rows where batch_id=${b.id} and applied_at is not null limit 1`;
        if (used) throw new Error("Applied rows prevent legacy year changes.");
        const observed = /^(?:\d{1,2}\.)(\d{4})$/.exec(b.sheet_name)?.[1];
        if (observed && Number(observed) !== input.returnYear && !input.acknowledgeSheetDifference)
          throw new Error("Explicit sheet-year difference acknowledgement required.");
        await tx`insert into nar_batch_review_events(batch_id,actor_user_id,before_year,after_year,expected_version,reason) values(${b.id},${actor.userId!},null,${input.returnYear},${input.expectedVersion},${input.reason})`;
        await tx`update nar_import_batches set return_year=${input.returnYear},updated_at=now() where id=${b.id}`;
        return { confirmed: true as const };
      });
    },
    async preview(actor: AuthenticatedActor, raw: z.input<typeof narPreviewSchema>) {
      const input = narPreviewSchema.parse(raw);
      return sql.begin(async (tx) => {
        await requireCurrentNarAdmin(tx, actor, true);
        const items: NarPreviewItem[] = [];
        for (const id of [...new Set(input.rowIds)].sort()) {
          const values = input.inputs[id] ?? {};
          items.push(
            await itemFor(
              await context(tx, input.batchId, id, values),
              values,
              input.dataOrigin,
              input.activateCurrentYear,
            ),
          );
        }
        const payloadHash = await hash({ batchId: input.batchId, items });
        const [p] = await tx<
          { id: string; expires_at: Date }[]
        >`insert into nar_apply_previews(batch_id,actor_user_id,auth_user_id,items,payload_hash) values(${input.batchId},${actor.userId!},${actor.authUserId},${tx.json(items as never)},${payloadHash}) returning id,expires_at`;
        return {
          previewId: p.id,
          revision: payloadHash,
          expiresAt: new Date(p.expires_at).toISOString(),
          selected: items.length,
          eligibleCount: items.filter((i) => !i.requiredInputs.length && !i.conflicts.length)
            .length,
          rows: items,
        };
      });
    },
    async execute(actor: AuthenticatedActor, raw: z.input<typeof narExecuteSchema>) {
      const input = narExecuteSchema.parse(raw);
      return sql.begin(async (tx) => {
        await requireCurrentNarAdmin(tx, actor, true);
        await tx`select pg_advisory_xact_lock(hashtextextended(${actor.userId! + ":" + input.idempotencyKey},0))`;
        const [prior] = await tx<
          Job[]
        >`select * from nar_apply_jobs where actor_user_id=${actor.userId!} and idempotency_key=${input.idempotencyKey}`;
        if (prior) {
          if (prior.preview_id !== input.previewId || prior.auth_user_id !== actor.authUserId)
            throw new Error("Idempotency payload conflict.");
          return { jobId: prior.id };
        }
        const [p] = await tx<
          { id: string; batch_id: string; items: NarPreviewItem[]; payload_hash: string }[]
        >`select * from nar_apply_previews where id=${input.previewId} and actor_user_id=${actor.userId!} and auth_user_id=${actor.authUserId} and expires_at>now()`;
        if (!p) throw new Error("Forbidden: own current preview is required.");
        if (p.payload_hash !== (await hash({ batchId: p.batch_id, items: p.items })))
          throw new Error("Preview integrity mismatch.");
        const [j] = await tx<
          { id: string }[]
        >`insert into nar_apply_jobs(preview_id,batch_id,actor_user_id,auth_user_id,idempotency_key,payload_hash) values(${p.id},${p.batch_id},${actor.userId!},${actor.authUserId},${input.idempotencyKey},${p.payload_hash}) returning id`;
        for (const [ordinal, item] of p.items.entries()) {
          const reason = item.conflicts.length
            ? item.conflicts.join(",")
            : item.requiredInputs.length
              ? "Required: " + item.requiredInputs.join(",")
              : null;
          await tx`insert into nar_apply_job_items(job_id,row_id,ordinal,snapshot,state,reason) values(${j.id},${item.rowId},${ordinal},${tx.json(item as never)},${reason ? (item.conflicts.length ? "conflict" : "failed") : "pending"},${reason})`;
        }
        await updateJobState(tx, j.id, "queued");
        return { jobId: j.id };
      });
    },
    async processNext(actor: AuthenticatedActor, jobId: string) {
      let attemptedRowId: string | undefined;
      try {
        return await sql.begin(async (tx) => {
          const job = await ownJob(tx, actor, jobId, true);
          if (job.state === "cancelled") return false;
          const [r] = await tx<
            { row_id: string; snapshot: NarPreviewItem }[]
          >`select row_id,snapshot from nar_apply_job_items where job_id=${jobId} and state='pending' order by ordinal limit 1 for update skip locked`;
          if (!r) {
            await updateJobState(tx, jobId);
            return false;
          }
          attemptedRowId = r.row_id;
          const item = r.snapshot,
            c = await context(tx, job.batch_id, r.row_id, item.input, true);
          if ((await hash(c)) !== item.revision) {
            await tx`update nar_apply_job_items set state='conflict',reason='Source, mapping or domain version changed; create a new preview.',attempts=attempts+1,finished_at=now() where job_id=${jobId} and row_id=${r.row_id}`;
            await updateJobState(tx, jobId);
            return true;
          }
          // Current time/year activation is rechecked even when the old preview's source token matches.
          const current = await itemFor(
            c,
            item.input,
            item.dataOrigin,
            item.dataOrigin === "client",
          );
          if (current.conflicts.length || current.requiredInputs.length) {
            await tx`update nar_apply_job_items set state='conflict',reason='Current row requirements changed.',attempts=attempts+1,finished_at=now() where job_id=${jobId} and row_id=${r.row_id}`;
            await updateJobState(tx, jobId);
            return true;
          }
          const before = c.case ? await domainSnapshot(tx, c.case.id) : null;
          const caseId = await applyRow(tx, actor, c, item);
          await tx`update nar_import_rows set applied_at=coalesce(applied_at,now()),applied_case_id=${caseId},matched_company_id=${item.candidate.companyId},matched_case_id=${caseId},apply_error=null,updated_at=now() where id=${r.row_id}`;
          const normalized = await domainSnapshot(tx, caseId);
          await tx`insert into nar_apply_journal(job_id,batch_id,row_id,case_id,actor_user_id,before_value,after_value,after_revision,command) values(${jobId},${job.batch_id},${r.row_id},${caseId},${actor.userId!},${before ? tx.json(before as never) : null},${tx.json(normalized as never)},${await hash(normalized)},${item.command})`;
          await tx`update nar_apply_job_items set state='applied',case_id=${caseId},attempts=attempts+1,finished_at=now() where job_id=${jobId} and row_id=${r.row_id}`;
          await updateJobState(tx, jobId);
          // Never label a selected subset as the whole batch completed.
          await tx`update nar_import_batches set status=case when not exists(select 1 from nar_import_rows where batch_id=${job.batch_id} and applied_at is null) then 'applied' else 'pending_review' end,applied_at=case when not exists(select 1 from nar_import_rows where batch_id=${job.batch_id} and applied_at is null) then now() else null end,updated_at=now() where id=${job.batch_id}`;
          return true;
        });
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : undefined;
        if (!attemptedRowId || !code || !["23505", "23514", "40001", "40P01"].includes(code))
          throw error;
        // A confirmed rolled-back SQL transaction may be recorded as failed. Connection/commit uncertainty throws; never blindly retries.
        return sql.begin(async (tx) => {
          await ownJob(tx, actor, jobId, true);
          const reason = `Confirmed SQL rollback (${code}); review a new preview before retry.`;
          const changed =
            await tx`update nar_apply_job_items set state='failed',reason=${reason},attempts=attempts+1,finished_at=now() where job_id=${jobId} and row_id=${attemptedRowId!} and state='pending' returning row_id`;
          if (changed.length)
            await tx`update nar_import_rows set apply_error=${reason},updated_at=now() where id=${attemptedRowId!} and applied_at is null`;
          await updateJobState(tx, jobId);
          return true;
        });
      }
    },
    async getJob(actor: AuthenticatedActor, jobId: string) {
      return sql.begin(async (tx) => {
        const j = await ownJob(tx, actor, jobId);
        const rows = await tx<
          {
            row_id: string;
            state: "pending" | "applied" | "conflict" | "failed" | "cancelled";
            reason: string | null;
            attempts: number;
            case_id: string | null;
            row_number: number;
            company_name: string;
          }[]
        >`select i.row_id,i.state,i.reason,i.attempts,i.case_id,r.row_number,r.company_name from nar_apply_job_items i join nar_import_rows r on r.id=i.row_id where i.job_id=${jobId} order by ordinal`;
        const [b] = await tx<
          { row_count: number }[]
        >`select row_count from nar_import_batches where id=${j.batch_id}`;
        const counts = { pending: 0, applied: 0, conflict: 0, failed: 0, cancelled: 0 };
        for (const r of rows) counts[r.state]++;
        return {
          jobId,
          state: j.state,
          selected: rows.length,
          unselected: b.row_count - rows.length,
          counts,
          rows,
        };
      });
    },
    async listJobs(
      actor: AuthenticatedActor,
      batchId: string,
      raw: z.input<typeof jobHistorySchema> = {},
    ) {
      const input = jobHistorySchema.parse(raw),
        limit = input.limit ?? 20;
      return sql.begin(async (tx) => {
        await requireCurrentNarAdmin(tx, actor, true);
        const rows = await tx<
          { id: string; state: string; createdAt: string }[]
        >`select j.id,j.state,to_char(j.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') "createdAt" from nar_apply_jobs j where j.actor_user_id=${actor.userId!} and j.auth_user_id=${actor.authUserId} and j.batch_id=${batchId} and (${input.cursor?.createdAt ?? null}::timestamptz is null or (j.created_at,j.id)<(${input.cursor?.createdAt ?? null}::timestamptz,${input.cursor?.id ?? null}::uuid)) order by j.created_at desc,j.id desc limit ${limit + 1}`;
        const items = rows.slice(0, limit),
          last = items.at(-1);
        return {
          items,
          nextCursor:
            rows.length > limit && last ? { id: last.id, createdAt: last.createdAt } : null,
        };
      });
    },
    async cancel(actor: AuthenticatedActor, jobId: string) {
      return sql.begin(async (tx) => {
        await ownJob(tx, actor, jobId, true);
        const rows =
          await tx`update nar_apply_job_items set state='cancelled',reason='Explicitly cancelled by current Admin.',finished_at=now() where job_id=${jobId} and state='pending' returning row_id`;
        if (rows.length)
          await tx`update nar_apply_jobs set state='cancelled',updated_at=now() where id=${jobId}`;
        return { cancelled: rows.length };
      });
    },
    async compensationPreview(actor: AuthenticatedActor, jobId: string) {
      return sql.begin(async (tx) => {
        await ownJob(tx, actor, jobId);
        const rows = await tx<
          {
            row_id: string;
            case_id: string;
            before_value: JsonValue | null;
            after_revision: string;
            company_name: string;
            row_number: number;
          }[]
        >`select j.row_id,j.case_id,j.before_value,j.after_revision,r.company_name,r.row_number from nar_apply_journal j join annual_return_cases a on a.id=j.case_id join nar_import_rows r on r.id=j.row_id where job_id=${jobId} order by j.created_at,j.id`;
        const projected = [];
        for (const r of rows) {
          const current = await domainSnapshot(tx, r.case_id);
          projected.push({
            rowId: r.row_id,
            caseId: r.case_id,
            companyName: r.company_name,
            rowNumber: r.row_number,
            proposedBefore: r.before_value,
            current,
            currentMatches: (await hash(current)) === r.after_revision,
            action: r.before_value
              ? "review_deadline_compensation"
              : "retain_case_and_review_archival",
            writes: 0 as const,
          });
        }
        return projected;
      });
    },
    async listOptions(actor: AuthenticatedActor) {
      return sql.begin(async (tx) => {
        await requireCurrentNarAdmin(tx, actor, true);
        const companies = await tx<
          { id: string; companyName: string; crNumber: string; dataOrigin: string }[]
        >`select id,company_name "companyName",cr_number "crNumber",data_origin "dataOrigin" from companies where status='active' and data_origin<>'fixture' order by company_name,id limit 20001`;
        if (companies.length > 20000)
          throw new Error("Company catalogue too large; narrow mapping scope before continuing.");
        const templates = await tx<
          { id: string; name: string }[]
        >`select id,name from checklist_templates where active and service_type like 'Annual Return%' order by name,id`;
        const owners = await tx<
          { id: string; name: string; teamName: string | null }[]
        >`select u.id,u.name,t.name "teamName" from users u join staff_profiles sp on sp.user_id=u.id left join teams t on t.id=u.team_id where u.active and sp.active and u.role=sp.role and u.team_id is not distinct from sp.team_id and u.role in ('Admin','Manager','Staff') order by u.name,u.id`;
        return { companies, templates, owners };
      });
    },
    async listMappingCompanies(actor: AuthenticatedActor) {
      return sql.begin(async (tx) => {
        await requireCurrentNarAdmin(tx, actor, true);
        return tx<
          { id: string; companyName: string; crNumber: string; dataOrigin: string }[]
        >`select id,company_name "companyName",cr_number "crNumber",data_origin "dataOrigin" from companies where status='active' and data_origin<>'fixture' order by company_name,id limit 20001`;
      });
    },
  };
}
export type NarApplyRepository = ReturnType<typeof createNarApplyRepository>;
export async function runNarApplyChunk({
  repository,
  actor,
  jobId,
  limit = 100,
  afterCommit,
}: {
  repository: NarApplyRepository;
  actor: AuthenticatedActor;
  jobId: string;
  limit?: number;
  afterCommit?: (processed: number) => void | Promise<void>;
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Apply chunk must be1–100.");
  let processed = 0;
  while (processed < limit && (await repository.processNext(actor, jobId))) {
    processed++;
    await afterCommit?.(processed);
  }
  return { processed };
}
