// Parent-only DB runner: identity must be proved before this test is executed.
// No dotenv loading, module-scope client, provider calls, or cleanup DELETEs.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { guardSqlTestLifetime } from "@/test/sql-test-lifetime";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createWhatsAppRepository } from "./repository";
import {
  listWhatsAppConversationPageForActor,
  listWhatsAppConversationMessagePageForActor,
} from "./server-fns";

const databaseUrl = process.env.TEST_DATABASE_URL;
const snapshotAt = "2001-01-01T00:00:00.000Z";
const lateAt = "2001-01-01T00:00:00.000001Z";
const threadAt = "2000-01-02T00:00:00.123456Z";
const conversationAt = "2000-01-01T00:00:00.654321Z";

describe.skipIf(!databaseUrl)("R21 transaction-owned SQL history pagination", () => {
  it("pages 101 scoped conversations and 201 messages without gaps, leaks or microsecond loss, then rolls back exact IDs", async ({
    signal,
  }) => {
    const runId = `r21-${randomUUID()}`;
    const teamIds = [randomUUID(), randomUUID()];
    const userIds = [randomUUID(), randomUUID()];
    const companyIds = [randomUUID(), randomUUID()];
    const contactIds = Array.from({ length: 102 }, () => randomUUID());
    const historyIds = Array.from({ length: 201 }, () => randomUUID());
    const otherMessageIds = Array.from({ length: 100 }, () => randomUUID());
    const foreignSharedId = randomUUID(),
      foreignContactMessageId = randomUUID();
    const lateThreadId = randomUUID(),
      lateConversationId = randomUUID();
    const mediaIds = [randomUUID(), randomUUID()];
    const allMessageIds = [
      ...historyIds,
      ...otherMessageIds,
      foreignSharedId,
      foreignContactMessageId,
      lateThreadId,
      lateConversationId,
    ];
    const ownedIds = {
      teams: teamIds,
      users: userIds,
      companies: companyIds,
      contacts: contactIds,
      messages: allMessageIds,
      media: mediaIds,
    };
    const createdIds: Record<keyof typeof ownedIds, string[]> = {
      teams: [],
      users: [],
      companies: [],
      contacts: [],
      messages: [],
      media: [],
    };
    const aContactIds = contactIds.slice(0, 101);
    const currentContact = aContactIds[0];
    const bContact = contactIds[101];
    const expectedContacts = [currentContact, ...aContactIds.slice(1).sort()];
    const tailContact = expectedContacts[100];
    const expectedMessages = [
      ...historyIds.slice(0, 199).sort().reverse(),
      historyIds[199],
      historyIds[200],
    ];
    const actorA: AuthenticatedActor = {
      authUserId: `${runId}-auth-a`,
      userId: userIds[0],
      teamId: teamIds[0],
      role: "Staff",
      active: true,
    };
    const actorB: AuthenticatedActor = {
      authUserId: `${runId}-auth-b`,
      userId: userIds[1],
      teamId: teamIds[1],
      role: "Staff",
      active: true,
    };
    const companyA = `${runId} Company Alpha`,
      companyB = `${runId} Company Beta`;
    const rollback = new Error(`${runId}: intentional rollback`);
    let fixtureInserted = false;
    let failure: unknown;
    const observed = {
      conversationPages: [] as number[],
      messagePages: [] as number[],
      conversationIds: [] as string[],
      messageIds: [] as string[],
      fixturePrecision: [] as {
        phase: string;
        checkedCount: number;
        mismatchIds: string[];
        samples: {
          id: string;
          expected: { received_at: string | null; sent_at: string | null; created_at: string };
          stored: { received_at: string | null; sent_at: string | null; created_at: string };
        }[];
      }[],
    };
    const evidenceDir = process.env.COSEC_EVIDENCE_DIR;
    async function receipt(phase: string, remaining?: { resource: string; id: string }[]) {
      const data = {
        runId,
        phase,
        fixtureInserted,
        allocatedIds: ownedIds,
        createdIds,
        observed,
        snapshotAt,
        rollbackVerified: remaining === undefined ? null : remaining.length === 0,
        remainingExactIds: remaining ?? null,
      };
      if (!evidenceDir) {
        if (phase === "allocated-before-client" || remaining !== undefined)
          console.info("R21_HISTORY_FIXTURE", JSON.stringify(data));
        return;
      }
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(
        join(evidenceDir, `R21-history-pagination-${runId}.json`),
        JSON.stringify(data, null, 2) + "\n",
      );
    }
    await receipt("allocated-before-client");
    // Constructed only inside the explicitly executed DB test, never on import.
    const raw = createSqlClient(databaseUrl!, { max: 1 });
    const sql = guardSqlTestLifetime(raw, () => signal);
    try {
      await sql.begin(async (tx) => {
        await tx`set local statement_timeout = '15s'`;
        await tx`set local lock_timeout = '3s'`;
        await tx`set local timezone = 'UTC'`;
        await tx`insert into teams (id, name, active) values
          (${teamIds[0]}, ${runId + " Team A"}, true), (${teamIds[1]}, ${runId + " Team B"}, true)`;
        createdIds.teams.push(...teamIds);
        await tx`insert into users (id, name, email, role, team_id, active) values
          (${userIds[0]}, ${runId + " Staff A"}, ${runId + "-a@example.invalid"}, 'Staff', ${teamIds[0]}, true),
          (${userIds[1]}, ${runId + " Staff B"}, ${runId + "-b@example.invalid"}, 'Staff', ${teamIds[1]}, true)`;
        createdIds.users.push(...userIds);
        await tx`insert into companies (
          id, company_name, cr_number, br_number, incorporation_date, annual_return_basis_date,
          registered_office, company_secretary, status, assigned_owner_id, assigned_team_id
        ) values
          (${companyIds[0]}, ${companyA}, ${runId + "-cr-a"}, ${runId + "-br-a"}, '2020-01-01', '2026-01-01', 'Synthetic local', 'Synthetic secretary', 'active', ${userIds[0]}, ${teamIds[0]}),
          (${companyIds[1]}, ${companyB}, ${runId + "-cr-b"}, ${runId + "-br-b"}, '2020-01-01', '2026-01-01', 'Synthetic local', 'Synthetic secretary', 'active', ${userIds[1]}, ${teamIds[1]})`;
        createdIds.companies.push(...companyIds);
        const contacts = contactIds.map((id, n) => ({
          id,
          provider: "woztell",
          whatsapp_id: `${runId}:${id}`,
          display_name: `${runId} 聯絡人 ${String(n === 101 ? 50 : n).padStart(3, "0")}`,
          company_id: n === 101 ? companyIds[1] : companyIds[0],
        }));
        await tx`insert into whatsapp_contacts ${tx(contacts, "id", "provider", "whatsapp_id", "display_name", "company_id")}`;
        createdIds.contacts.push(...contactIds);
        const history = historyIds.map((id, n) => {
          const at =
            n === 199
              ? "2000-01-02T00:00:00.123455Z"
              : n === 200
                ? "2000-01-02T00:00:00.123454Z"
                : threadAt;
          return {
            id,
            provider: "woztell",
            contact_id: currentContact,
            company_id: companyIds[0],
            direction: n % 3 === 0 ? "inbound" : "outbound",
            status: n % 3 === 0 ? "received" : n % 3 === 1 ? "sent" : "queued",
            body: `${runId} A history ${n}`,
            received_at: n % 3 === 0 ? at : null,
            sent_at: n % 3 === 1 ? at : null,
            created_at: n % 3 === 2 ? at : "1999-01-01T00:00:00Z",
          };
        });
        const others = otherMessageIds.map((id, n) => ({
          id,
          provider: "woztell",
          contact_id: aContactIds[n + 1],
          company_id: companyIds[0],
          direction: "inbound",
          status: "received",
          body: `${runId} Other ${n + 1}`,
          received_at: conversationAt,
          sent_at: null,
          created_at: "1999-01-01T00:00:00Z",
        }));
        const foreign = [
          {
            id: foreignSharedId,
            contact_id: currentContact,
            body: `${runId} B private shared history`,
          },
          {
            id: foreignContactMessageId,
            contact_id: bContact,
            body: `${runId} B private contact history`,
          },
        ].map((row) => ({
          ...row,
          provider: "woztell",
          company_id: companyIds[1],
          direction: "inbound",
          status: "received",
          received_at: "2000-01-02T12:00:00.111111Z",
          sent_at: null,
          created_at: "1999-01-01T00:00:00Z",
        }));
        const messages = [...history, ...others, ...foreign];
        async function insertMessages(rows: typeof messages, phase: "initial" | "late") {
          // JSON preserves the source strings. Timestamp conversion happens only
          // in PostgreSQL, avoiding the driver's millisecond Date serializer.
          await tx`insert into whatsapp_messages (
            id, provider, contact_id, company_id, direction, status, body,
            received_at, sent_at, created_at
          ) select fixture.id, fixture.provider, fixture.contact_id, fixture.company_id,
              fixture.direction, fixture.status, fixture.body,
              fixture.received_at::timestamptz, fixture.sent_at::timestamptz,
              fixture.created_at::timestamptz
            from jsonb_to_recordset(${tx.json(rows)}::jsonb) as fixture(
              id uuid, provider text, contact_id uuid, company_id uuid, direction text,
              status text, body text, received_at text, sent_at text, created_at text
            )`;
          createdIds.messages.push(...rows.map((row) => row.id));
          const stored = await tx<
            {
              id: string;
              received_at: string | null;
              sent_at: string | null;
              created_at: string;
              exact: boolean;
            }[]
          >`select message.id::text, message.received_at::text, message.sent_at::text,
              message.created_at::text,
              (message.received_at is not distinct from fixture.received_at::timestamptz
                and message.sent_at is not distinct from fixture.sent_at::timestamptz
                and message.created_at = fixture.created_at::timestamptz) as exact
            from whatsapp_messages message
            join jsonb_to_recordset(${tx.json(rows)}::jsonb) as fixture(
              id uuid, received_at text, sent_at text, created_at text
            ) on message.id = fixture.id
            order by message.id`;
          const sampleIds = new Set<string>([
            ...historyIds.slice(0, 3),
            ...historyIds.slice(199),
            otherMessageIds[0],
            foreignSharedId,
            lateThreadId,
            lateConversationId,
          ]);
          const precision = {
            phase,
            checkedCount: stored.length,
            mismatchIds: stored.filter((row) => !row.exact).map((row) => row.id),
            samples: stored
              .filter((row) => sampleIds.has(row.id))
              .map(({ id, received_at, sent_at, created_at }) => {
                const expected = rows.find((row) => row.id === id)!;
                return {
                  id,
                  expected: {
                    received_at: expected.received_at,
                    sent_at: expected.sent_at,
                    created_at: expected.created_at,
                  },
                  stored: { received_at, sent_at, created_at },
                };
              }),
          };
          observed.fixturePrecision.push(precision);
          await receipt(`fixture-${phase}-precision-checked`);
          expect(stored.map((row) => row.id)).toEqual(rows.map((row) => row.id).sort());
          expect(precision.mismatchIds).toEqual([]);
        }
        await insertMessages(messages, "initial");
        const media = mediaIds.map((id, position) => ({
          id,
          message_id: historyIds[0],
          provider_media_id: `${runId}-media-${position}`,
          media_type: "IMAGE",
          position,
        }));
        await tx`insert into whatsapp_message_media ${tx(media, "id", "message_id", "provider_media_id", "media_type", "position")}`;
        createdIds.media.push(...mediaIds);
        fixtureInserted = true;
        await receipt("fixture-inserted-uncommitted");
        const repository = createWhatsAppRepository({ sql: tx });
        const dependencies = { repository };
        // Only Date is controlled; SQL, connection and test timeout timers are real.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(snapshotAt);

        const directA = await repository.listConversations({
          actor: actorA,
          search: companyA,
          limit: 501,
        });
        expect(directA.map((row) => row.contactId)).toEqual(expectedContacts);
        expect(directA[0]).toMatchObject({
          contactId: currentContact,
          companyId: companyIds[0],
          companyName: companyA,
        });
        expect(directA[0].lastMessageAt).toContain(".123456");
        expect(directA[0].lastMessageBody).toBe(
          history[historyIds.indexOf(expectedMessages[0])].body,
        );
        expect(directA.every((row) => !row.lastMessageBody.includes("B private"))).toBe(true);
        expect(
          (
            await repository.listConversations({
              actor: actorA,
              search: `${runId} 聯絡人 050`,
              limit: 100,
            })
          ).map((row) => row.contactId),
        ).toEqual([aContactIds[50]]);
        expect(
          await repository.listConversations({ actor: actorA, search: companyB, limit: 100 }),
        ).toEqual([]);
        const directB = await repository.listConversations({
          actor: actorB,
          search: runId,
          limit: 100,
        });
        expect(directB.map((row) => row.contactId).sort()).toEqual(
          [currentContact, bContact].sort(),
        );
        expect(
          directB.every(
            (row) => row.companyId === companyIds[1] && row.lastMessageBody.includes("B private"),
          ),
        ).toBe(true);
        expect(
          await repository.listConversationMessages({
            actor: actorA,
            contactId: bContact,
            limit: 201,
          }),
        ).toEqual([]);
        expect(
          (
            await repository.listConversationMessages({
              actor: actorB,
              contactId: currentContact,
              limit: 201,
            })
          ).map((row) => row.id),
        ).toEqual([foreignSharedId]);
        const rawHistory = await repository.listConversationMessages({
          actor: actorA,
          contactId: currentContact,
          limit: 501,
        });
        expect(rawHistory.map((row) => row.id)).toEqual(expectedMessages);
        expect(
          rawHistory
            .find((row) => row.id === historyIds[0])
            ?.attachments.map((item) => item.providerMediaId),
        ).toEqual([`${runId}-media-0`, `${runId}-media-1`]);

        const conversations = await listWhatsAppConversationPageForActor(
          actorA,
          { search: ` ${companyA} `, limit: 100 },
          dependencies,
        );
        const thread = await listWhatsAppConversationMessagePageForActor(
          actorA,
          { contactId: currentContact, limit: 200 },
          dependencies,
        );
        expect(conversations.items.map((row) => row.contactId)).toEqual(
          expectedContacts.slice(0, 100),
        );
        expect(conversations.nextCursor).toMatchObject({
          id: expectedContacts[99],
          asOf: snapshotAt,
        });
        expect(conversations.nextCursor!.at).toContain(".654321");
        expect(thread.items.map((row) => row.id)).toEqual(expectedMessages.slice(0, 200));
        expect(thread.nextCursor).toMatchObject({ id: historyIds[199], asOf: snapshotAt });
        expect(thread.nextCursor!.at).toContain(".123455");
        const currentOther = await listWhatsAppConversationMessagePageForActor(
          actorA,
          { contactId: aContactIds[1], limit: 200 },
          dependencies,
        );
        expect(currentOther.items.map((row) => row.id)).toEqual([otherMessageIds[0]]);
        expect(currentOther.nextCursor).toBeNull();
        const bPage = await listWhatsAppConversationMessagePageForActor(
          actorB,
          { contactId: currentContact, limit: 200 },
          dependencies,
        );
        expect(bPage.items.map((row) => row.id)).toEqual([foreignSharedId]);
        expect(
          (await listWhatsAppConversationPageForActor(actorB, { search: companyA }, dependencies))
            .items,
        ).toEqual([]);
        const noTeam = { ...actorA, teamId: null };
        await expect(repository.listConversations({ actor: noTeam })).rejects.toThrow(
          /^Forbidden:/,
        );
        await expect(
          repository.listConversationMessages({ actor: noTeam, contactId: currentContact }),
        ).rejects.toThrow(/^Forbidden:/);
        await expect(
          listWhatsAppConversationPageForActor(noTeam, {}, dependencies),
        ).rejects.toThrow(/^Forbidden:/);
        await expect(
          listWhatsAppConversationMessagePageForActor(
            noTeam,
            { contactId: currentContact },
            dependencies,
          ),
        ).rejects.toThrow(/^Forbidden:/);
        await expect(
          listWhatsAppConversationPageForActor(
            actorB,
            { search: companyA, cursor: conversations.nextCursor! },
            dependencies,
          ),
        ).rejects.toThrow(/cursor scope changed/i);
        await expect(
          listWhatsAppConversationMessagePageForActor(
            actorB,
            { contactId: currentContact, cursor: thread.nextCursor! },
            dependencies,
          ),
        ).rejects.toThrow(/cursor scope changed/i);
        await expect(
          listWhatsAppConversationMessagePageForActor(
            actorA,
            { contactId: aContactIds[1], cursor: thread.nextCursor! },
            dependencies,
          ),
        ).rejects.toThrow(/cursor scope changed/i);
        await expect(
          listWhatsAppConversationPageForActor(
            actorA,
            { search: "changed search", cursor: conversations.nextCursor! },
            dependencies,
          ),
        ).rejects.toThrow(/cursor scope changed/i);

        const lateMessages = [
          {
            id: lateThreadId,
            contact_id: currentContact,
            body: `${runId} new current-contact message`,
          },
          {
            id: lateConversationId,
            contact_id: tailContact,
            body: `${runId} new tail-conversation message`,
          },
        ].map((row) => ({
          ...row,
          provider: "woztell",
          company_id: companyIds[0],
          direction: "inbound",
          status: "received",
          received_at: lateAt,
          sent_at: null,
          created_at: lateAt,
        }));
        await insertMessages(lateMessages, "late");
        vi.setSystemTime("2001-01-01T00:00:01.000Z");
        const conversationTail = await listWhatsAppConversationPageForActor(
          actorA,
          { search: companyA, limit: 100, cursor: conversations.nextCursor! },
          dependencies,
        );
        const messageTail = await listWhatsAppConversationMessagePageForActor(
          actorA,
          { contactId: currentContact, limit: 200, cursor: thread.nextCursor! },
          dependencies,
        );
        observed.conversationPages = [conversations.items.length, conversationTail.items.length];
        observed.messagePages = [thread.items.length, messageTail.items.length];
        observed.conversationIds = [...conversations.items, ...conversationTail.items].map(
          (row) => row.contactId,
        );
        observed.messageIds = [...thread.items, ...messageTail.items].map((row) => row.id);
        await receipt("continuation-pages-read");
        expect(conversationTail.items.map((row) => row.contactId)).toEqual([tailContact]);
        expect(conversationTail.items[0].lastMessageAt).toContain(".654321");
        expect(conversationTail.nextCursor).toBeNull();
        expect(messageTail.items.map((row) => row.id)).toEqual([historyIds[200]]);
        expect(messageTail.items[0].createdAt).toContain(".123454");
        expect(messageTail.nextCursor).toBeNull();
        expect(observed.conversationIds).toEqual(expectedContacts);
        expect(new Set(observed.conversationIds).size).toBe(101);
        expect(observed.messageIds).toEqual(expectedMessages);
        expect(new Set(observed.messageIds).size).toBe(201);
        expect(
          (
            await repository.listConversationMessages({
              actor: actorA,
              contactId: currentContact,
              asOf: snapshotAt,
              limit: 501,
            })
          ).map((row) => row.id),
        ).toEqual(expectedMessages);
        const fresh = await listWhatsAppConversationPageForActor(
          actorA,
          { search: companyA, limit: 100 },
          dependencies,
        );
        expect(
          fresh.items
            .slice(0, 2)
            .map((row) => row.contactId)
            .sort(),
        ).toEqual([currentContact, tailContact].sort());
        expect(
          fresh.items
            .slice(0, 2)
            .map((row) => row.lastMessageBody)
            .sort(),
        ).toEqual(lateMessages.map((row) => row.body).sort());
        expect(
          (
            await listWhatsAppConversationMessagePageForActor(
              actorA,
              { contactId: currentContact, limit: 1 },
              dependencies,
            )
          ).items.map((row) => row.id),
        ).toEqual([lateThreadId]);
        throw rollback;
      });
      failure = new Error("Owned R21 transaction unexpectedly committed");
    } catch (error) {
      failure = error;
    } finally {
      vi.useRealTimers();
      try {
        // Unwrapped, awaited read-only teardown still works after a timeout abort.
        // Every predicate names only this test's preallocated random primary keys.
        const remaining = await raw<{ resource: string; id: string }[]>`
          select 'team' as resource, id::text from teams where id = any(${teamIds}::uuid[])
          union all select 'user', id::text from users where id = any(${userIds}::uuid[])
          union all select 'company', id::text from companies where id = any(${companyIds}::uuid[])
          union all select 'contact', id::text from whatsapp_contacts where id = any(${contactIds}::uuid[])
          union all select 'message', id::text from whatsapp_messages where id = any(${allMessageIds}::uuid[])
          union all select 'media', id::text from whatsapp_message_media where id = any(${mediaIds}::uuid[])
          order by resource, id`;
        await receipt(
          failure === rollback
            ? "intentional-rollback-completed"
            : "failed-transaction-postread-completed",
          remaining,
        );
        expect(remaining).toEqual([]);
      } finally {
        await raw.end({ timeout: 5 });
      }
    }
    if (failure !== rollback) throw failure;
  }, 120_000);
});
