import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
export async function businessCaseFixture(tx: SqlClient | postgres.TransactionSql, count = 300) {
  const tag = randomUUID(),
    team = randomUUID(),
    foreignTeam = randomUUID(),
    owner = randomUUID(),
    colleague = randomUUID(),
    foreignOwner = randomUUID();
  await tx`insert into teams(id,name) values (${team},${tag}||' own'),(${foreignTeam},${tag}||' foreign')`;
  await tx`insert into users(id,name,email,role,team_id,active) values
 (${owner},'本隊陳同事',${tag}||'a@fixture.invalid','Staff',${team},true),
 (${colleague},'本隊李同事',${tag}||'b@fixture.invalid','Staff',${team},true),
 (${foreignOwner},'另一隊同事',${tag}||'c@fixture.invalid','Staff',${foreignTeam},true)`;
  const companies =
    await tx`insert into companies(company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin) values
 ('同名公司',${tag}||'1',${tag}||'1','2020-01-01','2026-01-01','Owned test','Owned test',${owner},${team},'client'),
 ('同名公司',${tag}||'2',${tag}||'2','2020-01-01','2026-01-01','Owned test','Owned test',${colleague},${team},'client'),
 ('同名公司',${tag}||'3',${tag}||'3','2020-01-01','2026-01-01','Owned test','Owned test',${foreignOwner},${foreignTeam},'client') returning id,cr_number`;
  const a = companies.find((c) => c.cr_number === tag + "1")!.id,
    b = companies.find((c) => c.cr_number === tag + "2")!.id,
    foreign = companies.find((c) => c.cr_number === tag + "3")!.id;
  const incorporation =
    await tx`insert into incorporation_cases(proposed_company_name_en,proposed_company_name_zh,proposed_registered_office,proposed_company_secretary,registered_capital,business_nature,status,owner_id,team_id,target_completion_date,company_id,completed_at,created_at)
 select case when n=${count} then '尾頁中文100%_literal' else ${tag}||' case '||n end,'中文公司','Owned','Owned',1000,'Owned',
 case when n%5=0 then 'Completed' when n%3=0 then 'Documents pending' else 'Intake' end,
 case when n%2=0 then ${owner}::uuid else ${colleague}::uuid end,${team}::uuid,
 case when n%2=0 then '2026-10-10'::date else '2026-10-30'::date end,
 case when n%5=0 then ${a}::uuid else null end,case when n%5=0 then now() else null end,'2026-10-01T00:00:00.123456Z'
 from generate_series(1,${count}) n returning id,status,owner_id`;
  await tx`insert into incorporation_cases(proposed_company_name_en,proposed_registered_office,proposed_company_secretary,registered_capital,business_nature,owner_id,team_id,target_completion_date)
 values ('尾頁中文100%_literal','Owned','Owned',1000,'Owned',${foreignOwner},${foreignTeam},'2026-10-10')`;
  const changes =
    await tx`insert into corporate_change_requests(company_id,change_type,status,owner_id,quoted_fee,new_name_en,completed_at,created_at,effective_date)
 select case when n%2=0 then ${a}::uuid else ${b}::uuid end,'name_change',
 case when n%5=0 then 'Completed' when n%3=0 then 'Documents pending' else 'Requested' end,
 case when n%2=0 then ${owner}::uuid else ${colleague}::uuid end,1200.25,
 case when n=${count} then '尾頁中文100%_literal' else ${tag}||' new '||n end,
 case when n%5=0 then now() else null end,'2026-10-01T00:00:00.123456Z','2020-01-01'
 from generate_series(1,${count}) n returning id,status,owner_id,company_id`;
  await tx`insert into corporate_change_requests(company_id,change_type,owner_id,quoted_fee,new_name_en) values (${foreign},'name_change',${foreignOwner},1200,'尾頁中文100%_literal')`;
  return {
    tag,
    team,
    foreignTeam,
    owner,
    colleague,
    foreignOwner,
    companies: { a, b, foreign },
    incorporation,
    changes,
  };
}
