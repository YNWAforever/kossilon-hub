import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import { getSqlClient, type SqlClient } from "@/server/db/client";

type QueryClient = SqlClient | postgres.TransactionSql;
type Resource = "clients" | "annual-return-cases" | "work-items";
type Mode = "add" | "remove";
type TagRow = { id: string; teamId: string | null; revision: number };
export type ResourceTagDecision = {
  resourceId: string;
  revision: number | null;
  state: "eligible" | "skipped" | "forbidden";
  reasonCode: string | null;
};
export type ResourceTagResult = {
  resourceId: string;
  revision: number;
  state: "succeeded" | "skipped";
  reasonCode: string | null;
  auditRef: string | null;
};

function transaction<T>(
  sql: QueryClient,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return "begin" in sql ? (sql.begin(work) as Promise<T>) : (sql.savepoint(work) as Promise<T>);
}
function normalizeTag(value: string): string {
  const tag = value.trim().normalize("NFC").toLowerCase();
  if (
    !tag ||
    [...tag].length > 64 ||
    [...tag].some((char) => {
      const code = char.codePointAt(0)!;
      return code < 32 || code === 127;
    })
  )
    throw new Error("Tag must contain 1 to 64 visible characters.");
  return tag;
}
function validateIds(ids: string[]): void {
  if (ids.length < 1 || ids.length > 1000 || new Set(ids).size !== ids.length)
    throw new Error("Select 1 to 1000 distinct resources.");
  if (ids.some((id) => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
    throw new Error("A valid resource ID is required.");
}
async function currentActor(sql: QueryClient, actor: AuthenticatedActor) {
  if (!actor.active || !actor.userId || (actor.role !== "Admin" && actor.role !== "Manager"))
    throw new Error("Forbidden: active Admin or Manager required.");
  const [row] = await sql<{ id: string; role: "Admin" | "Manager"; teamId: string | null }[]>`
    select u.id,u.role,u.team_id "teamId" from users u
    join staff_profiles sp on sp.user_id=u.id
    where u.id=${actor.userId} and sp.auth_user_id=${actor.authUserId}
      and u.active=true and sp.active=true and u.role=sp.role
      and u.team_id is not distinct from sp.team_id and u.role in ('Admin','Manager')
    for share of u,sp`;
  if (!row || row.role !== actor.role || row.teamId !== actor.teamId)
    throw new Error("Forbidden: actor scope changed; preview again.");
  return row;
}
function inScope(actor: { role: "Admin" | "Manager"; teamId: string | null }, row: TagRow) {
  return actor.role === "Admin" || (Boolean(actor.teamId) && row.teamId === actor.teamId);
}
async function readRows(sql: QueryClient, resource: Resource, ids: string[]): Promise<TagRow[]> {
  if (resource === "clients")
    return sql<TagRow[]>`select id,assigned_team_id "teamId",tag_revision revision
      from companies where id=any(${ids}::uuid[])`;
  if (resource === "annual-return-cases")
    return sql<TagRow[]>`select arc.id,c.assigned_team_id "teamId",arc.tag_revision revision
      from annual_return_cases arc join companies c on c.id=arc.company_id
      where arc.id=any(${ids}::uuid[])`;
  return sql<TagRow[]>`select id,team_id "teamId",tag_revision revision
    from work_items where id=any(${ids}::uuid[])`;
}
async function readTagIds(
  sql: QueryClient,
  resource: Resource,
  ids: string[],
  tag: string,
): Promise<Set<string>> {
  const rows =
    resource === "clients"
      ? await sql<{ id: string }[]>`select company_id id from company_tags
        where company_id=any(${ids}::uuid[]) and tag=${tag}`
      : resource === "annual-return-cases"
        ? await sql<{ id: string }[]>`select case_id id from annual_return_case_tags
          where case_id=any(${ids}::uuid[]) and tag=${tag}`
        : await sql<{ id: string }[]>`select work_item_id id from work_item_tags
          where work_item_id=any(${ids}::uuid[]) and tag=${tag}`;
  return new Set(rows.map((row) => row.id));
}
async function lockRow(tx: postgres.TransactionSql, resource: Resource, id: string) {
  if (resource === "clients") {
    const [row] = await tx<TagRow[]>`select id,assigned_team_id "teamId",
      tag_revision revision from companies where id=${id} for update`;
    return row ?? null;
  }
  if (resource === "annual-return-cases") {
    const [row] = await tx<TagRow[]>`select arc.id,c.assigned_team_id "teamId",
      arc.tag_revision revision from annual_return_cases arc
      join companies c on c.id=arc.company_id where arc.id=${id}
      for update of arc,c`;
    return row ?? null;
  }
  const [row] = await tx<TagRow[]>`select id,team_id "teamId",tag_revision revision
    from work_items where id=${id} for update`;
  return row ?? null;
}
async function changeTag(
  tx: postgres.TransactionSql,
  resource: Resource,
  id: string,
  tag: string,
  mode: Mode,
  actorId: string,
) {
  if (resource === "clients") {
    if (mode === "add")
      await tx`insert into company_tags(company_id,tag,created_by_id)
        values (${id},${tag},${actorId})`;
    else await tx`delete from company_tags where company_id=${id} and tag=${tag}`;
    await tx`update companies set tag_revision=tag_revision+1 where id=${id}`;
  } else if (resource === "annual-return-cases") {
    if (mode === "add")
      await tx`insert into annual_return_case_tags(case_id,tag,created_by_id)
        values (${id},${tag},${actorId})`;
    else await tx`delete from annual_return_case_tags where case_id=${id} and tag=${tag}`;
    await tx`update annual_return_cases set tag_revision=tag_revision+1 where id=${id}`;
  } else {
    if (mode === "add")
      await tx`insert into work_item_tags(work_item_id,tag,created_by_id)
        values (${id},${tag},${actorId})`;
    else await tx`delete from work_item_tags where work_item_id=${id} and tag=${tag}`;
    await tx`update work_items set tag_revision=tag_revision+1 where id=${id}`;
  }
}

/** Read-only per-item decisions. Foreign IDs never disclose revision or tag state. */
export async function previewResourceTagsForActor(
  actor: AuthenticatedActor,
  input: { resource: Resource; ids: string[]; tag: string; mode: Mode },
  dependencies: { sql?: QueryClient } = {},
): Promise<ResourceTagDecision[]> {
  validateIds(input.ids);
  const tag = normalizeTag(input.tag);
  const sql = dependencies.sql ?? getSqlClient();
  const current = await currentActor(sql, actor);
  const rows = await readRows(sql, input.resource, input.ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const tagged = await readTagIds(sql, input.resource, input.ids, tag);
  return input.ids.map((resourceId) => {
    const row = byId.get(resourceId);
    if (!row || !inScope(current, row))
      return {
        resourceId,
        revision: null,
        state: "forbidden",
        reasonCode: "RESOURCE_OUT_OF_SCOPE",
      };
    const present = tagged.has(resourceId);
    const noChange = input.mode === "add" ? present : !present;
    return {
      resourceId,
      revision: row.revision,
      state: noChange ? "skipped" : "eligible",
      reasonCode: noChange ? (present ? "TAG_ALREADY_PRESENT" : "TAG_ABSENT") : null,
    };
  });
}

/** One authorized, versioned tag write; T09 runner calls this inside its item transaction. */
export async function applyOneResourceTagForActor(
  actor: AuthenticatedActor,
  input: {
    resource: Resource;
    resourceId: string;
    tag: string;
    mode: Mode;
    expectedRevision: number;
  },
  dependencies: { sql?: QueryClient } = {},
): Promise<ResourceTagResult> {
  validateIds([input.resourceId]);
  const tag = normalizeTag(input.tag);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
    throw new Error("A valid tag revision is required.");
  const sql = dependencies.sql ?? getSqlClient();
  return transaction(sql, async (tx) => {
    const current = await currentActor(tx, actor);
    const row = await lockRow(tx, input.resource, input.resourceId);
    if (!row || !inScope(current, row)) throw new Error("Forbidden: resource outside actor scope.");
    if (row.revision !== input.expectedRevision)
      throw new Error("Resource tag revision changed; preview again.");
    const present = (await readTagIds(tx, input.resource, [input.resourceId], tag)).has(
      input.resourceId,
    );
    const noChange = input.mode === "add" ? present : !present;
    if (noChange)
      return {
        resourceId: input.resourceId,
        revision: row.revision,
        state: "skipped" as const,
        reasonCode: present ? "TAG_ALREADY_PRESENT" : "TAG_ABSENT",
        auditRef: null,
      };
    await changeTag(tx, input.resource, input.resourceId, tag, input.mode, current.id);
    const [event] = await tx<{ id: string }[]>`
      insert into resource_tag_events(resource_type,resource_id,tag,action,actor_id,
        revision_before,revision_after)
      values (${input.resource},${input.resourceId},${tag},${input.mode},${current.id},
        ${row.revision},${row.revision + 1}) returning id`;
    return {
      resourceId: input.resourceId,
      revision: row.revision + 1,
      state: "succeeded" as const,
      reasonCode: null,
      auditRef: event.id,
    };
  });
}
