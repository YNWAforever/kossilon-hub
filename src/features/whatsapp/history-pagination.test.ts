import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import * as server from "./server-fns";
import { createWhatsAppRepository } from "./repository";

// Unit-only SQL recorder. A real DB client must never be constructed here.
vi.mock("@/server/db/client", () => ({
  createSqlClient: () => {
    throw new Error("Real SQL client forbidden in unit test");
  },
  getSqlClient: () => {
    throw new Error("Real SQL client forbidden in unit test");
  },
}));
const actor: AuthenticatedActor = {
  authUserId: "auth-A",
  userId: "22222222-2222-4222-8222-222222222222",
  role: "Staff",
  teamId: "33333333-3333-4333-8333-333333333333",
  active: true,
};
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const at = "2026-10-20T02:00:00.123456Z";
const conversation = (n: number) => ({
  contactId: id(n),
  displayName: `Contact ${n}`,
  phoneE164: null,
  companyId: null,
  companyName: null,
  caseId: null,
  lastMessageBody: "body",
  lastMessageDirection: "inbound" as const,
  lastMessageAt: at,
});
const message = (n: number) => ({
  id: id(n),
  direction: "outbound" as const,
  status: "queued" as const,
  body: `Message ${n}`,
  attachments: [],
  caseId: null,
  sentAs: null,
  sentTemplateName: null,
  createdAt: at,
  receivedAt: null,
  sentAt: null,
});

describe("scoped WhatsApp history pages (unit)", () => {
  it("reaches conversation 101 with a bounded lookahead and a stable tie-break cursor", async () => {
    const repository = {
      listConversations: vi
        .fn()
        .mockResolvedValueOnce(Array.from({ length: 101 }, (_, n) => conversation(n + 1)))
        .mockResolvedValueOnce([conversation(101)]),
      listConversationMessages: vi.fn(),
    };
    const first = await server.listWhatsAppConversationPageForActor(
      actor,
      { limit: 100, search: "  中文公司  " },
      { repository },
    );
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toMatchObject({ at, id: id(100) });
    expect(repository.listConversations).toHaveBeenCalledWith(
      expect.objectContaining({ actor, limit: 101, search: "中文公司" }),
    );
    const second = await server.listWhatsAppConversationPageForActor(
      actor,
      { limit: 100, search: "中文公司", cursor: first.nextCursor! },
      { repository },
    );
    expect(second.items.map((row) => row.contactId)).toEqual([id(101)]);
    expect(second.nextCursor).toBeNull();
    expect(repository.listConversations).toHaveBeenLastCalledWith(
      expect.objectContaining({
        asOf: first.nextCursor!.asOf,
        cursor: first.nextCursor,
      }),
    );
  });
  it("reaches older message 201 and ties the cursor to the contact and actor", async () => {
    const repository = {
      listConversations: vi.fn(),
      listConversationMessages: vi
        .fn()
        .mockResolvedValueOnce(Array.from({ length: 201 }, (_, n) => message(201 - n)))
        .mockResolvedValueOnce([message(1)]),
    };
    const first = await server.listWhatsAppConversationMessagePageForActor(
      actor,
      { contactId: id(1), limit: 200 },
      { repository },
    );
    expect(first.items).toHaveLength(200);
    expect(first.nextCursor).toMatchObject({ at, id: id(2) });
    const second = await server.listWhatsAppConversationMessagePageForActor(
      actor,
      { contactId: id(1), limit: 200, cursor: first.nextCursor! },
      { repository },
    );
    expect(second.items.map((row) => row.id)).toEqual([id(1)]);
    await expect(
      server.listWhatsAppConversationMessagePageForActor(
        actor,
        { contactId: id(9), cursor: first.nextCursor! },
        { repository },
      ),
    ).rejects.toThrow(/cursor/i);
    await expect(
      server.listWhatsAppConversationMessagePageForActor(
        { ...actor, authUserId: "auth-B" },
        { contactId: id(1), cursor: first.nextCursor! },
        { repository },
      ),
    ).rejects.toThrow(/cursor/i);
    expect(repository.listConversationMessages).toHaveBeenCalledTimes(2);
  });
  it("rejects cursors from a different search and malformed or excessive requests", async () => {
    const repository = {
      listConversations: vi.fn().mockResolvedValue([conversation(1), conversation(2)]),
      listConversationMessages: vi.fn(),
    };
    const first = await server.listWhatsAppConversationPageForActor(
      actor,
      { search: "A", limit: 1 },
      { repository },
    );
    await expect(
      server.listWhatsAppConversationPageForActor(
        actor,
        { search: "B", cursor: first.nextCursor! },
        { repository },
      ),
    ).rejects.toThrow(/cursor/i);
    expect(() =>
      server.listWhatsAppConversationsInputSchema.parse({
        cursor: { at: "bad", id: "bad", scope: "bad" },
      }),
    ).toThrow();
    await expect(
      server.listWhatsAppConversationPageForActor(actor, { limit: 5000 }, { repository }),
    ).rejects.toThrow();
    expect(repository.listConversations).toHaveBeenCalledTimes(1);
  });
  it.each([{ role: "Client" as const }, { active: false }, { teamId: null }])(
    "refuses forbidden actor before querying %s",
    async (overrides) => {
      const repository = { listConversations: vi.fn(), listConversationMessages: vi.fn() };
      await expect(
        server.listWhatsAppConversationPageForActor({ ...actor, ...overrides }, {}, { repository }),
      ).rejects.toThrow(/^Forbidden:/);
      expect(repository.listConversations).not.toHaveBeenCalled();
    },
  );
  it("binds search, scope and both cursor tuple directions in actual repository reads", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: parts.join("?"), values });
      return [];
    };
    const repo = createWhatsAppRepository({ sql: sql as never });
    const cursor = { at, id: id(50), scope: "unit" };
    await repo.listConversations({ actor, search: "50%_中文", cursor, limit: 101 });
    expect(calls[0]!.sql).toMatch(/occurred_at\s*<[^]*contact\.id\s*>/);
    expect(calls[0]!.values).toContain("%50\\%\\_中文%");
    expect(calls[0]!.values).toContain(actor.teamId);
    expect(calls[0]!.values).toContain(at);
    expect(calls[0]!.values).toContain(id(50));
    expect(calls[0]!.values.at(-1)).toBe(101);
    await repo.listConversationMessages({ actor, contactId: id(1), cursor, limit: 201 });
    expect(calls[1]!.sql).toMatch(/coalesce\(sent_at, received_at, created_at\)[^]*<[^]*id\s*</);
    expect(calls[1]!.values).toContain(actor.userId);
    expect(calls[1]!.values).toContain(id(1));
    expect(calls[1]!.values.at(-1)).toBe(201);
  });
  it.each(["listConversations", "listConversationMessages"] as const)(
    "%s binds cursor and cutoff strings as text before timestamp conversion",
    async (method) => {
      const calls: { sql: string; values: unknown[] }[] = [];
      const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: parts.join("?"), values });
        return [];
      };
      const repo = createWhatsAppRepository({ sql: sql as never });
      const asOf = "2026-10-20T02:00:01.654321Z";
      await repo[method]({
        actor,
        contactId: id(1),
        cursor: { at, id: id(50), scope: "unit" },
        asOf,
      });
      expect(calls).toHaveLength(1);
      // Parameter type inference must choose text; timestamptz parameters invoke
      // the driver's Date serializer and truncate these microsecond strings.
      expect(calls[0].sql.match(/\?::text::timestamptz/g)).toHaveLength(5);
      expect(calls[0].values.filter((value) => value === at)).toHaveLength(3);
      expect(calls[0].values.filter((value) => value === asOf)).toHaveLength(2);
    },
  );
});
