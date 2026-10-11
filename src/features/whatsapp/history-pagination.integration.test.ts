import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createWhatsAppHistoryRepository } from "./history-repository";
describe.skipIf(!process.env.TEST_DATABASE_URL)("R21 recorded history pages", () => {
  it("reaches thread101/message201 and keeps shared-contact foreign messages private, including empty threads", async () => {
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const team = randomUUID(),
            other = randomUUID(),
            tag = randomUUID();
          await tx`insert into teams(id,name) values (${team},'R21 own'),(${other},'R21 foreign')`;
          const [owner] = await tx`select id from users where active limit 1`;
          const [company] =
            await tx`insert into companies(company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin) values ('R21own',${tag},${tag},'2020-01-01','2026-01-01','Test','Test',${owner.id},${team},'client') returning id`;
          const [foreign] =
            await tx`insert into companies(company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin) values ('R21private',${tag}||'foreign',${tag}||'foreign','2020-01-01','2026-01-01','Test','Test',${owner.id},${other},'client') returning id`;
          const contacts =
            await tx`insert into whatsapp_contacts(whatsapp_id,display_name,company_id) select ${tag}||n,case when n=101 then '中文尾頁100%_' else 'R21contact'||n end,${company.id} from generate_series(1,101)n returning id,display_name`;
          const [empty] =
            await tx`insert into whatsapp_contacts(whatsapp_id,display_name,company_id) values (${tag}||'empty','R21empty',${company.id}) returning id`;
          const primary = contacts[0].id;
          await tx`insert into whatsapp_messages(contact_id,company_id,direction,status,body,received_at,created_at) select id,${company.id},'inbound','received','R21latest','2026-10-01T00:00:00.123456Z','2026-10-01T00:00:00.123456Z' from whatsapp_contacts where id=any(${contacts.map((c) => c.id)}::uuid[])`;
          await tx`insert into whatsapp_messages(contact_id,company_id,direction,status,body,received_at,created_at) select ${primary},${company.id},'inbound','received','R21history'||n,'2026-10-01T00:00:00.123456Z','2026-10-01T00:00:00.123456Z' from generate_series(1,200)n`;
          await tx`insert into whatsapp_messages(contact_id,company_id,direction,status,body,received_at) values (${primary},${foreign.id},'inbound','received','PRIVATE FOREIGN','2030-01-01T00:00Z')`;
          const actor = {
            userId: owner.id,
            authUserId: "r21-owned",
            role: "Staff" as const,
            teamId: team,
            active: true,
          };
          const repo = createWhatsAppHistoryRepository(tx),
            first = await repo.conversations(actor, {});
          expect(first.total).toBe(102);
          expect(first.items).toHaveLength(50);
          let cursor = first.nextCursor;
          const ids = new Set(first.items.map((c) => c.contactId));
          while (cursor) {
            const page = await repo.conversations(actor, { cursor });
            for (const c of page.items) {
              expect(ids.has(c.contactId)).toBe(false);
              ids.add(c.contactId);
            }
            cursor = page.nextCursor;
          }
          expect(ids.size).toBe(102);
          expect(ids.has(empty.id)).toBe(true);
          const found = await repo.conversations(actor, { q: "中文尾頁100%_" });
          expect(found.total).toBe(1);
          expect(found.items[0].displayName).toBe("中文尾頁100%_");
          const messages = await repo.messages(actor, { contactId: primary });
          expect(messages.total).toBe(201);
          const messageIds = new Set(messages.items.map((m) => m.id));
          cursor = messages.nextCursor;
          while (cursor) {
            const page = await repo.messages(actor, { contactId: primary, cursor });
            for (const m of page.items) {
              expect(m.body).not.toContain("PRIVATE");
              expect(messageIds.has(m.id)).toBe(false);
              messageIds.add(m.id);
            }
            cursor = page.nextCursor;
          }
          expect(messageIds.size).toBe(201);
          expect(
            (await repo.messages({ ...actor, teamId: other }, { contactId: primary })).total,
          ).toBe(1);
          await expect(
            repo.messages(actor, { contactId: empty.id, cursor: messages.nextCursor! }),
          ).rejects.toThrow(/cursor/i);
          await expect(repo.conversations({ ...actor, teamId: null }, {})).rejects.toThrow(
            /Forbidden/,
          );
          await expect(repo.conversations({ ...actor, active: false }, {})).rejects.toThrow(
            /Forbidden/,
          );
          await expect(repo.conversations({ ...actor, role: "Client" }, {})).rejects.toThrow(
            /Forbidden/,
          );
          throw Error("rollback R21");
        }),
      ).rejects.toThrow("rollback R21");
    } finally {
      await sql.end();
    }
  }, 30000);
});
