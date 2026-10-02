/** Run with Bun. Only an owned scratch schema on the dedicated LOCAL test DB. */
import postgres from "postgres";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { createAnnualReturnRepository } from "../src/features/annual-return/repository";
import { createDocumentRepository } from "../src/features/documents/repository";
import { deriveWorkViews } from "../src/features/annual-return/work-views";
import { operationalRead } from "../src/server/db/operational-read";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const target = new URL(url);
if (
  target.hostname !== "127.0.0.1" ||
  target.port !== "55441" ||
  target.pathname !== "/kossilon_pr02_ci"
)
  throw new Error("Benchmark permits only the dedicated local test database");
const schema = "audit_perf_" + crypto.randomUUID().replaceAll("-", "");
if (!/^audit_perf_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid owned schema");
let queries = 0;
const plansOnly = process.argv.includes("--plans-only");
let metricsQuery: { query: string; parameters: never[] } | undefined;
const admin = postgres(url, { ssl: false, max: 1, onnotice: () => {} });
const sql = postgres(url, {
  ssl: false,
  max: 25,
  connection: { search_path: schema + ",public", statement_timeout: 60000 },
  debug: (_connection, query, parameters) => {
    queries++;
    if (query.includes('"chaseToday"') && !query.startsWith("explain"))
      metricsQuery = { query, parameters: parameters as never[] };
  },
});
const owner = "20000000-0000-0000-0000-000000000001",
  today = "2026-10-02",
  key = schema;
const result: { [key: string]: unknown } = {
  at: new Date().toISOString(),
  build: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runtime: process.versions,
  hardware: {
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
  },
  dataset: { cases: 10000, documents: 50000, checklist: 10000 },
  scope: "same random company-name prefix; Admin-equivalent synthetic reference owner",
  cache: "first connection/statement sample then warm; OS/Postgres buffer caches NOT flushed",
  measurements: [],
};
const samples: unknown[] = [];
let created = false;
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
const counts = async () => {
  const [row] =
    await admin`select (select count(*) from public.companies)::int companies,(select count(*) from public.annual_return_cases)::int cases,(select count(*) from public.documents)::int documents`;
  return row;
};
const beforePublic = await counts();
try {
  await admin.unsafe(`create schema ${schema}`);
  created = true;
  for (const table of [
    "companies",
    "annual_return_cases",
    "annual_return_checklist_items",
    "documents",
  ])
    await admin.unsafe(`create table ${schema}.${table} (like public.${table} including all)`);
  await sql`insert into companies(company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id)
    select ${key}||' Scale '||lpad(n::text,5,'0'),${key}||n,${key}||n,'2020-01-01'::date,'2026-09-01'::date,'Local','Local','active',${owner}::uuid,'10000000-0000-0000-0000-000000000001'::uuid from generate_series(1,10000)n`;
  await sql`insert into annual_return_cases(company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id)select id,2026,'2026-09-01'::date,'2026-10-01'::date,'Documents pending','green',${owner}::uuid from companies`;
  await sql`insert into annual_return_checklist_items(case_id,item_label,required,status,due_date)select id,'Missing synthetic evidence',true,'Missing','2026-10-01'::date from annual_return_cases`;
  await sql`insert into documents(company_id,case_id,file_type,file_name,storage_url,upload_source,verification_status,uploaded_by)select arc.company_id,arc.id,'other',${key}||' Document '||n,${key}||'/'||arc.id||'/'||n,'staff','pending',${owner}::uuid from annual_return_cases arc cross join generate_series(1,5)n`;
  for (const table of [
    "companies",
    "annual_return_cases",
    "annual_return_checklist_items",
    "documents",
  ])
    await sql.unsafe(`analyze ${schema}.${table}`);
  const cases = createAnnualReturnRepository({ sql, today }),
    documents = createDocumentRepository({ sql });
  const workloads = [
    {
      name: "today-before",
      run: async () =>
        deriveWorkViews(await cases.listAllCases({ q: key }), today, { userId: owner }),
      rows: (data: unknown) =>
        (data as { rows: unknown[] }[]).reduce((n, p) => n + p.rows.length, 0),
    },
    {
      name: "today-after",
      run: async () => ({
        page: await cases.listWorkView({
          scope: { q: key },
          view: "chaseToday",
          viewerUserId: owner,
          limit: 50,
        }),
        counts: await cases.workViewMetrics({ scope: { q: key }, viewerUserId: owner }),
      }),
      rows: () => 50,
    },
    // Conservative lower-bound baseline: original unbounded metadata read without costly version joins.
    {
      name: "documents-before-lower-bound",
      run: async () =>
        sql`select d.* from documents d join companies c on c.id=d.company_id where c.company_name like ${key + "%"} order by d.uploaded_at desc,d.id`,
      rows: (data: unknown) => (data as unknown[]).length,
    },
    {
      name: "documents-after",
      run: async () => documents.listDocumentPage({ q: key, limit: 100 }),
      rows: (data: unknown) => (data as { documents: unknown[] }).documents.length,
    },
  ];
  async function measure(
    workload: (typeof workloads)[number],
    concurrency: number,
    iterations: number,
    cache: string,
  ) {
    const elapsed: number[] = [],
      payload: number[] = [],
      returned: number[] = [],
      queryStart = queries,
      mem = process.memoryUsage(),
      failures: string[] = [];
    for (let i = 0; i < iterations; i++)
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          const start = performance.now();
          try {
            const data = await workload.run();
            elapsed.push(performance.now() - start);
            payload.push(Buffer.byteLength(JSON.stringify(data)));
            returned.push(workload.rows(data));
          } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
          }
        }),
      );
    samples.push({
      workload: workload.name,
      concurrency,
      iterations,
      cache,
      samples: elapsed.length,
      ms: summary(elapsed),
      queryCount: queries - queryStart,
      returnedDTOs: summary(returned),
      payloadBytes: summary(payload),
      heapDelta: process.memoryUsage().heapUsed - mem.heapUsed,
      rssDelta: process.memoryUsage().rss - mem.rss,
      errors: failures,
    });
    console.log(JSON.stringify(samples.at(-1)));
    if (failures.length) throw new Error("Benchmark workload failed; retain failure evidence");
  }
  if (!plansOnly) {
    for (const workload of workloads) {
      await measure(workload, 1, 1, "first connection/statement");
      await measure(workload, 1, 5, "warm");
    }
    for (const concurrency of [10, 25])
      for (const workload of workloads)
        await measure(workload, concurrency, 1, "warm concurrent wave");
  } else await measure(workloads[1], 1, 1, "query-plan diagnostic");
  result.explain = {
    documentPage:
      await sql`explain(analyze,buffers,format json)select d.id from documents d join companies c on c.id=d.company_id where c.company_name like ${key + "%"} order by d.uploaded_at desc,d.id limit 101`,
    casePage:
      await sql`explain(analyze,buffers,format json)select arc.id from annual_return_cases arc join companies c on c.id=arc.company_id where c.company_name like ${key + "%"} and exists(select 1 from annual_return_checklist_items ci where ci.case_id=arc.id and ci.required and ci.status='Missing') order by arc.filing_due_date,arc.id limit 51`,
  };
  if (metricsQuery) {
    result.metricsPlan = await operationalRead(sql, async (tx) =>
      tx.unsafe(
        "explain(analyze,buffers,format json)" + metricsQuery!.query,
        metricsQuery!.parameters,
      ),
    );
    if (plansOnly)
      result.metricsWithoutJit = await sql.begin(async (tx) => {
        await tx`set local jit=off`;
        return tx.unsafe(
          "explain(analyze,buffers,format json)" + metricsQuery!.query,
          metricsQuery!.parameters,
        );
      });
  }
} catch (error) {
  result.failure = String(error);
  process.exitCode = 1;
} finally {
  await sql.end();
  if (created) await admin.unsafe(`drop schema ${schema} cascade`);
  result.publicRowsUnchanged = JSON.stringify(beforePublic) === JSON.stringify(await counts());
  result.ownedSchemaRemoved =
    (await admin`select nspname from pg_namespace where nspname=${schema}`).length === 0;
  result.measurements = samples;
  await admin.end();
  await mkdir("docs/audit-remediation/evidence", { recursive: true });
  await writeFile(
    "docs/audit-remediation/evidence/2026-10-02-t21-" +
      (plansOnly ? "query-plans" : "performance") +
      ".json",
    JSON.stringify(result, null, 2) + "\n",
  );
  if (!result.publicRowsUnchanged || !result.ownedSchemaRemoved) {
    console.error("Owned benchmark cleanup/row preservation gate failed");
    process.exitCode = 1;
  }
}
