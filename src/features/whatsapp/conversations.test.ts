import { describe, expect, it } from "vitest";

import {
  conversationContactLabel,
  conversationMessageOccurredAt,
  sortConversationMessagesOldestFirst,
  type WhatsAppConversationMessage,
} from "./conversations";

function message(
  overrides: Partial<WhatsAppConversationMessage> & Pick<WhatsAppConversationMessage, "id">,
): WhatsAppConversationMessage {
  return {
    direction: "outbound",
    status: "queued",
    body: "body",
    caseId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    receivedAt: null,
    sentAt: null,
    ...overrides,
  };
}

describe("conversationMessageOccurredAt", () => {
  it("uses sent_at for an outbound message that has been sent", () => {
    expect(
      conversationMessageOccurredAt(
        message({
          id: "a",
          direction: "outbound",
          status: "sent",
          createdAt: "2026-07-01T09:00:00.000Z",
          sentAt: "2026-07-01T10:00:00.000Z",
        }),
      ),
    ).toBe("2026-07-01T10:00:00.000Z");
  });

  it("uses received_at for an inbound message", () => {
    // Inbound rows never carry sent_at — the table's check constraint requires
    // received_at instead — so received_at has to win over created_at.
    expect(
      conversationMessageOccurredAt(
        message({
          id: "a",
          direction: "inbound",
          status: "received",
          createdAt: "2026-07-01T11:00:00.000Z",
          receivedAt: "2026-07-01T10:00:00.000Z",
        }),
      ),
    ).toBe("2026-07-01T10:00:00.000Z");
  });

  it("falls back to created_at for an outbound message still queued", () => {
    // queueOutboundTemplateMessage writes status 'queued' with no sent_at. Without
    // the created_at fallback a queued reply would sort as if it had no time at all.
    expect(
      conversationMessageOccurredAt(
        message({ id: "a", status: "queued", createdAt: "2026-07-01T12:00:00.000Z" }),
      ),
    ).toBe("2026-07-01T12:00:00.000Z");
  });
});

describe("sortConversationMessagesOldestFirst", () => {
  it("orders a thread oldest first regardless of the order rows arrive in", () => {
    // The repository fetches newest-first so the row limit keeps the most recent
    // slice of a long thread; the transcript still has to read top to bottom.
    const sorted = sortConversationMessagesOldestFirst([
      message({ id: "newest", sentAt: "2026-07-03T00:00:00.000Z" }),
      message({ id: "oldest", sentAt: "2026-07-01T00:00:00.000Z" }),
      message({ id: "middle", sentAt: "2026-07-02T00:00:00.000Z" }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["oldest", "middle", "newest"]);
  });

  it("does not mutate the array it was given", () => {
    const messages = [
      message({ id: "newest", sentAt: "2026-07-03T00:00:00.000Z" }),
      message({ id: "oldest", sentAt: "2026-07-01T00:00:00.000Z" }),
    ];

    sortConversationMessagesOldestFirst(messages);

    expect(messages.map((entry) => entry.id)).toEqual(["newest", "oldest"]);
  });
});

describe("conversationContactLabel", () => {
  it("prefers the stored display name", () => {
    expect(conversationContactLabel({ displayName: "Ada Wong", phoneE164: "+85290001111" })).toBe(
      "Ada Wong",
    );
  });

  it("falls back to the phone number when the provider sent no name", () => {
    // whatsapp_contacts.display_name is nullable: a contact created from a phone
    // number alone has no name until the provider supplies one.
    expect(conversationContactLabel({ displayName: null, phoneE164: "+85290001111" })).toBe(
      "+85290001111",
    );
  });

  it("never renders an empty label when neither identity is present", () => {
    expect(conversationContactLabel({ displayName: null, phoneE164: null })).toBe(
      "Unknown contact",
    );
  });
});
