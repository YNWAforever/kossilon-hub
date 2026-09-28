import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import type { DocumentItem } from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type CaseSnapshot = {
  caseId: string;
  companyName?: string;
  versionId: string | null;
  revision?: number;
  status: string;
  packageDelivered?: boolean;
  items?: { documentId: string | null; status: string; evidenceId: string | null }[];
};
type VersionSnapshot = {
  id: string;
  templateId: string;
  documents: DocumentItem[];
};
export type TemplateUsagePage = {
  items: { caseId: string; companyName: string; status: string; versionId: string }[];
  nextCursor: string | null;
  unknownLegacyCount: number;
  scopeLabel: "all linked cases";
};
export type TemplateRolloutPreview = {
  fromVersion: string;
  toVersion: string;
  selectionCount: number;
  eligibleCount: number;
  conflictCount: number;
  skippedCount: number;
  items: {
    caseId: string;
    revision: number;
    state: "eligible" | "conflict" | "skipped";
    reason: string | null;
    addedRequired: string[];
    removedRequired: string[];
    readyAfter: boolean;
    preservedEvidenceIds: string[];
  }[];
};
export type TemplateUsageDependencies = {
  sql?: QueryClient;
  listCaseSnapshots?: () => Promise<CaseSnapshot[]>;
  loadVersions?: () => Promise<VersionSnapshot[]>;
  loadCases?: () => Promise<CaseSnapshot[]>;
};

function assertAdmin(actor: AuthenticatedActor): void {
  if (!actor.active || actor.role !== "Admin" || !actor.userId)
    throw new Error("Forbidden: active Admin access is required.");
}
function validId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new Error("A valid version or case ID is required.");
}

export async function listTemplateUsageForActor(
  actor: AuthenticatedActor,
  input: { templateVersionId: string; cursor: string | null },
  dependencies: TemplateUsageDependencies = {},
): Promise<TemplateUsagePage> {
  assertAdmin(actor);
  validId(input.templateVersionId);
  if (input.cursor) validId(input.cursor);
  let rows: CaseSnapshot[];
  let unknownLegacyCount: number;
  if (dependencies.listCaseSnapshots) {
    const all = await dependencies.listCaseSnapshots();
    unknownLegacyCount = all.filter((row) => row.versionId === null).length;
    rows = all
      .filter(
        (row) =>
          row.versionId === input.templateVersionId && (!input.cursor || row.caseId > input.cursor),
      )
      .sort((a, b) => a.caseId.localeCompare(b.caseId))
      .slice(0, 51);
  } else {
    const sql = dependencies.sql ?? getSqlClient();
    const [unknown] = await sql<
      { n: number }[]
    >`select count(*)::int n from annual_return_cases where template_version_id is null`;
    unknownLegacyCount = unknown.n;
    rows = await sql<CaseSnapshot[]>`select arc.id "caseId", c.company_name "companyName",
      arc.template_version_id "versionId", arc.current_status status
      from annual_return_cases arc join companies c on c.id=arc.company_id
      where arc.template_version_id=${input.templateVersionId}
        and (${input.cursor}::uuid is null or arc.id > ${input.cursor}::uuid)
      order by arc.id limit 51`;
  }
  return {
    items: rows.slice(0, 50).map((row) => ({
      caseId: row.caseId,
      companyName: row.companyName ?? "",
      status: row.status,
      versionId: row.versionId!,
    })),
    nextCursor: rows.length > 50 ? rows[49]!.caseId : null,
    unknownLegacyCount,
    scopeLabel: "all linked cases",
  };
}

export async function previewTemplateRolloutForActor(
  actor: AuthenticatedActor,
  input: {
    fromVersion: string;
    toVersion: string;
    selection: { kind: "ids"; ids: string[] };
  },
  dependencies: TemplateUsageDependencies = {},
): Promise<TemplateRolloutPreview> {
  assertAdmin(actor);
  validId(input.fromVersion);
  validId(input.toVersion);
  if (input.fromVersion === input.toVersion) throw new Error("Choose a different target version.");
  if (
    input.selection.kind !== "ids" ||
    input.selection.ids.length < 1 ||
    input.selection.ids.length > 1000 ||
    new Set(input.selection.ids).size !== input.selection.ids.length
  )
    throw new Error("Select 1 to 1000 distinct cases.");
  for (const id of input.selection.ids) validId(id);
  const sql = dependencies.sql ?? (dependencies.loadVersions ? null : getSqlClient());
  const versions =
    (await dependencies.loadVersions?.()) ??
    (await sql!<
      VersionSnapshot[]
    >`select id,template_id "templateId",documents from checklist_template_versions
      where id in (${input.fromVersion},${input.toVersion})`);
  const from = versions.find((row) => row.id === input.fromVersion);
  const to = versions.find((row) => row.id === input.toVersion);
  if (!from || !to || from.templateId !== to.templateId)
    throw new Error("Published versions of the same template are required.");
  const rows =
    (await dependencies.loadCases?.()) ??
    (await sql!<CaseSnapshot[]>`select arc.id "caseId",arc.template_version_id "versionId",
      arc.template_revision revision,arc.current_status status,
      exists(select 1 from package_handoffs ph where ph.case_id=arc.id
        and ph.status not in ('failed','cancelled')) "packageDelivered"
      from annual_return_cases arc where arc.id=any(${input.selection.ids}::uuid[])`);
  const byId = new Map(rows.map((row) => [row.caseId, row]));
  const fromDocs = new Map(from.documents.map((doc) => [doc.id, doc]));
  const toDocs = new Map(to.documents.map((doc) => [doc.id, doc]));
  const items: TemplateRolloutPreview["items"] = [];
  for (const caseId of input.selection.ids) {
    const row = byId.get(caseId);
    if (!row) throw new Error("Forbidden: selected case is unavailable.");
    const caseItems =
      row.items ??
      (await sql!<
        { documentId: string | null; status: string; evidenceId: string | null }[]
      >`select template_document_id "documentId",status,document_id "evidenceId"
        from annual_return_checklist_items where case_id=${caseId}`);
    const addedRequired = [...toDocs.values()]
      .filter((doc) => doc.required && !fromDocs.has(doc.id))
      .map((doc) => doc.id);
    const removedRequired = [...fromDocs.values()]
      .filter((doc) => doc.required && !toDocs.has(doc.id))
      .map((doc) => doc.id);
    const preservedEvidenceIds = caseItems
      .map((item) => item.evidenceId)
      .filter((id): id is string => id !== null);
    const verifiedConflict = caseItems.some((item) => {
      if (item.status !== "Verified" || !item.documentId) return false;
      const old = fromDocs.get(item.documentId);
      const next = toDocs.get(item.documentId);
      return (
        !old ||
        !next ||
        old.label !== next.label ||
        old.required !== next.required ||
        old.daysBeforeDue !== next.daysBeforeDue
      );
    });
    let state: "eligible" | "conflict" | "skipped" = "eligible";
    let reason: string | null = null;
    if (row.versionId !== from.id) {
      state = "conflict";
      reason = "Case template version changed or is unknown.";
    } else if (row.status === "Filed" || row.status === "Completed" || row.packageDelivered) {
      state = "skipped";
      reason = "Package released or case closed.";
    } else if (verifiedConflict) {
      state = "conflict";
      reason = "Published requirement change conflicts with verified evidence.";
    }
    const readyAfter =
      state === "eligible" &&
      [...toDocs.values()]
        .filter((doc) => doc.required)
        .every((doc) =>
          caseItems.some((item) => item.documentId === doc.id && item.status === "Verified"),
        );
    items.push({
      caseId,
      revision: row.revision ?? 1,
      state,
      reason,
      addedRequired,
      removedRequired,
      readyAfter,
      preservedEvidenceIds,
    });
  }
  return {
    fromVersion: from.id,
    toVersion: to.id,
    selectionCount: items.length,
    eligibleCount: items.filter((item) => item.state === "eligible").length,
    conflictCount: items.filter((item) => item.state === "conflict").length,
    skippedCount: items.filter((item) => item.state === "skipped").length,
    items,
  };
}
