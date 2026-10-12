import { z } from "zod";
import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import { decodeListCursor, encodeListCursor, listPageSize, literalContains } from "@/lib/list-page";
import { queueScopeSql } from "./queue-scope";
import type { QueueFilters } from "./repository";

export const queueFilterOptionsSchema = z
  .object({
    view: z.enum(["mine", "team", "breached"]).default("mine"),
    kind: z.enum(["owner", "workType"]),
    q: z.string().trim().max(200).default(""),
    cursor: z.string().max(8192).optional(),
    limit: listPageSize,
  })
  .strict();
export type QueueFilterOptionsInput = Omit<z.input<typeof queueFilterOptionsSchema>, "view">;
export type QueueFilterOptionPage = {
  items: { id: string; label: string }[];
  nextCursor: string | null;
};

/** Facets use the authorized collection, independently of the loaded work page and UI filters. */
export async function readQueueFilterOptions(
  sql: SqlClient | postgres.TransactionSql,
  scope: QueueFilters,
  requested: QueueFilterOptionsInput,
): Promise<QueueFilterOptionPage> {
  const input = queueFilterOptionsSchema.parse({ ...requested, view: "team" });
  const key = JSON.stringify(["queue-facets", scope, input.kind, input.q, input.limit]);
  const cursor = decodeListCursor(input.cursor, key, 2);
  const rows = await sql<{ id: string; label: string }[]>`
    with choices as materialized (
      select distinct ${input.kind === "owner" ? sql`w.owner_id::text` : sql`w.work_type`} id,
        ${input.kind === "owner" ? sql`coalesce(nullif(u.name,''),'未有姓名') || coalesce(' · '||t.name,'')` : sql`w.work_type`} label
      from work_items w join companies c on c.id=w.company_id
      left join users u on u.id=w.owner_id left join teams t on t.id=u.team_id
      where ${queueScopeSql(sql, scope)} and (${input.kind !== "owner"} or w.owner_id is not null)
    )
    select id,label from choices where label ilike ${literalContains(input.q)}
      and (${cursor === null} or (label collate "C",id collate "C")>(${cursor?.[0] ?? ""}::text collate "C",${cursor?.[1] ?? ""}::text collate "C"))
    order by label collate "C",id collate "C" limit ${input.limit + 1}`;
  const items = rows.slice(0, input.limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > input.limit && last ? encodeListCursor(key, [last.label, last.id]) : null,
  };
}
