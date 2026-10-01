import "dotenv/config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

type Query = postgres.Sql | postgres.TransactionSql;
export async function auditDataOrigin(sql: Query) {
  const [counts] = await sql<
    { origin_counts: { data_origin: string; count: number }[]; total: number }[]
  >`
    select (select coalesce(jsonb_agg(groups), '[]'::jsonb) from
      (select data_origin, count(*)::int count from companies group by data_origin) groups) origin_counts,
      (select count(*)::int from companies) total
  `;
  const companies = await sql<
    { id: string; data_origin: string; updated_at: string; case_count: number }[]
  >`
    select c.id, c.data_origin, c.updated_at::text,
      (select count(*)::int from annual_return_cases arc where arc.company_id=c.id) case_count
    from companies c order by c.id limit 100
  `;
  const queues = await sql<{ data_origin: string; status: string; count: number }[]>`
    select c.data_origin, o.status, count(*)::int count
    from notification_outbox o join companies c on c.id=o.company_id
    where o.status in ('pending','processing','failed') group by c.data_origin,o.status
  `;
  return {
    scope: "recorded DB classification; business provenance requires reviewed external evidence",
    originCounts: counts.origin_counts,
    totalCompanies: counts.total,
    companies,
    truncated: counts.total > companies.length,
    queues,
    reclassificationPerformed: false,
    nextAction:
      "Business data owner reviews provenance per company before any separately approved versioned/audited reclassification. No name/UUID inference.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for read-only origin inventory");
  const sslSetting = (process.env.DATABASE_SSL ?? process.env.PGSSLMODE ?? "require").toLowerCase();
  const sql = postgres(url, {
    max: 1,
    ssl: ["disable", "disabled", "false", "off", "0", "no"].includes(sslSetting)
      ? false
      : "require",
    onnotice: () => undefined,
  });
  try {
    console.log(
      JSON.stringify(await sql.begin("read only", async (tx) => auditDataOrigin(tx)), null, 2),
    );
  } catch {
    console.error(
      "Origin inventory unavailable; verify access/configuration. No classification changes performed.",
    );
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
