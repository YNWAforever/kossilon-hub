// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WhatsAppConversation } from "../conversations";
import { ProductionWhatsAppInbox } from "./production-inbox";

const serverFns = vi.hoisted(() => ({
  listWhatsAppConversations: vi.fn(),
  listWhatsAppConversationMessages: vi.fn(),
  getWhatsAppIntegrationStatus: vi.fn(),
}));

vi.mock("../server-fns", () => serverFns);
vi.mock("../history-server-fns", () => ({
  listWhatsAppConversationPage: async (input: unknown) => {
    const items = await serverFns.listWhatsAppConversations(input);
    return Array.isArray(items)
      ? { items, total: items.length, nextCursor: null, observedAt: "2026-10-12T00:00Z" }
      : items;
  },
  listWhatsAppMessagePage: async (input: unknown) => {
    const items = await serverFns.listWhatsAppConversationMessages(input);
    return Array.isArray(items)
      ? { items, total: items.length, nextCursor: null, observedAt: "2026-10-12T00:00Z" }
      : items;
  },
}));
vi.mock("./message-intake", () => ({ MessageIntake: () => null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/annual-returns">{children}</a>,
}));

const contactId = "11111111-1111-4111-8111-111111111111";
const EMPTY_INBOX_MESSAGE = "No WhatsApp conversations are recorded in your current scope.";

function makeConversation(overrides: Partial<WhatsAppConversation> = {}): WhatsAppConversation {
  return {
    contactId,
    displayName: "Ada Wong",
    phoneE164: "+85290001111",
    companyId: "22222222-2222-4222-8222-222222222222",
    companyName: "Acme Company Limited",
    caseId: "33333333-3333-4333-8333-333333333333",
    lastMessageBody: "Any update on the annual return?",
    lastMessageDirection: "inbound",
    lastMessageAt: "2026-07-30T02:00:00.000Z",
    ...overrides,
  };
}

const connected = {
  provider: "woztell" as const,
  deliveryMode: "live" as const,
  webhookConfigured: true,
  liveSendConfigured: true,
  missingLiveEnvVars: [] as string[],
};

const notConnected = {
  provider: "woztell" as const,
  deliveryMode: "blocked" as const,
  webhookConfigured: false,
  liveSendConfigured: false,
  missingLiveEnvVars: ["WOZTELL_ACCESS_TOKEN", "WOZTELL_WEBHOOK_SECRET"],
};

function renderInbox() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionWhatsAppInbox />
    </QueryClientProvider>,
  );
}

describe("production WhatsApp inbox", () => {
  it("loads thread101 by its cursor and searches recorded scope instead of the current rail", async () => {
    serverFns.listWhatsAppConversations.mockImplementation(
      ({ data }: { data: { q: string; cursor?: string; limit: number } }) => {
        expect(data.limit).toBe(50);
        const items =
          data.cursor || data.q
            ? [
                makeConversation({
                  contactId: "44444444-4444-4444-8444-444444444444",
                  displayName: "中文 thread101",
                }),
              ]
            : [makeConversation()];
        return {
          items,
          total: data.q ? 1 : 101,
          nextCursor: data.cursor || data.q ? null : "thread-cursor",
          observedAt: "2026-10-12T00:00Z",
        };
      },
    );
    renderInbox();
    fireEvent.click(await screen.findByRole("button", { name: "載入較早對話" }));
    await screen.findByRole("button", { name: /中文 thread101/ });
    expect(screen.getByRole("heading", { name: "Ada Wong" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search all recorded conversations"), {
      target: { value: "中文" },
    });
    await screen.findByRole("heading", { name: "中文 thread101" });
    expect(screen.queryByRole("button", { name: /Ada Wong/ })).toBeNull();
  });
  it("retains old messages on a failed older page, retries its cursor, preserves scroll and accepts new messages without changing thread", async () => {
    const message = (id: string) => ({
      id,
      direction: "inbound",
      status: "received",
      body: "page-message " + id,
      caseId: null,
      createdAt: "2026-10-01T00:00Z",
      receivedAt: "2026-10-01T00:00Z",
      sentAt: null,
      sentAs: null,
      sentTemplateName: null,
      attachments: [],
    });
    const page = (ids: string[], nextCursor: string | null) => ({
      items: ids.map(message),
      total: 201,
      nextCursor,
      observedAt: "2026-10-12T00:00Z",
    });
    let failure = true,
      arrived = false;
    serverFns.listWhatsAppConversations.mockResolvedValue([makeConversation()]);
    serverFns.listWhatsAppConversationMessages.mockImplementation(
      ({ data }: { data: { cursor?: string; limit: number } }) => {
        expect(data.limit).toBe(50);
        if (data.cursor) {
          if (failure) {
            failure = false;
            throw Error("offline older");
          }
          return page(["001", "002"], null);
        }
        return page(arrived ? ["203", "201", "202"] : ["201", "202"], "message-cursor");
      },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ProductionWhatsAppInbox />
      </QueryClientProvider>,
    );
    await screen.findByText("page-message 201");
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", {
      configurable: true,
      get: () => screen.queryAllByText(/^page-message/).length * 100,
    });
    log.scrollTop = 77;
    fireEvent.click(screen.getByRole("button", { name: "載入更早訊息" }));
    await screen.findByText("offline older");
    expect(screen.getByText("page-message 201")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重試訊息" }));
    await screen.findByText("page-message 001");
    await waitFor(() => expect(log.scrollTop).toBe(277));
    arrived = true;
    await act(() => client.refetchQueries({ queryKey: ["whatsapp-latest"] }));
    fireEvent.click(await screen.findByRole("button", { name: /有新訊息/ }));
    await screen.findByText("page-message 203");
    expect(screen.getByRole("heading", { name: "Ada Wong" })).toBeTruthy();
    expect(screen.getByText("page-message 001")).toBeTruthy();
    expect(log.scrollTop).toBe(277);
  });
  it("does not claim inbound is disabled when only outbound bindings are missing", async () => {
    serverFns.listWhatsAppConversations.mockResolvedValue([]);
    serverFns.getWhatsAppIntegrationStatus.mockResolvedValue({
      ...notConnected,
      webhookConfigured: true,
      missingLiveEnvVars: ["WOZTELL_ACCESS_TOKEN", "WOZTELL_CHANNEL_ID"],
    });
    renderInbox();
    await screen.findByText(/WOZTELL_ACCESS_TOKEN/);
    expect(screen.queryByText(/Inbound messages are not being recorded/)).toBeNull();
  });
  beforeEach(() => {
    serverFns.listWhatsAppConversations.mockReset();
    serverFns.listWhatsAppConversationMessages.mockReset();
    serverFns.getWhatsAppIntegrationStatus.mockReset();
    serverFns.listWhatsAppConversationMessages.mockResolvedValue([]);
    serverFns.getWhatsAppIntegrationStatus.mockResolvedValue(connected);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders real conversations", async () => {
    serverFns.listWhatsAppConversations.mockResolvedValue([makeConversation()]);
    renderInbox();

    // The label appears twice by design — once in the rail, once above the thread.
    expect(await screen.findByRole("button", { name: /Ada Wong/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ada Wong" })).toBeTruthy();
    expect(screen.getByText("Any update on the annual return?")).toBeTruthy();
  });

  it("falls back to the phone number when the provider sent no display name", async () => {
    serverFns.listWhatsAppConversations.mockResolvedValue([
      makeConversation({ displayName: null }),
    ]);
    renderInbox();

    expect(await screen.findByRole("heading", { name: "+85290001111" })).toBeTruthy();
  });

  it("does not claim the inbox is empty when the conversation query failed", async () => {
    // Same defect shape as payments.tsx: on error `data` is undefined, so the list
    // is empty and isPending is false. Without an isError guard the screen shows
    // "unavailable" and "no conversations" at once.
    serverFns.listWhatsAppConversations.mockRejectedValue(new Error("boom"));
    renderInbox();

    await screen.findByRole("alert");

    expect(screen.queryByText(EMPTY_INBOX_MESSAGE)).toBeNull();
  });

  it("says the provider is not connected instead of showing an empty inbox", async () => {
    // With no Woztell credentials the webhook cannot verify a signature, so
    // whatsapp_messages is guaranteed empty. Reporting that as "no conversations
    // yet" would read as "no client has messaged us", which is a different claim.
    serverFns.listWhatsAppConversations.mockResolvedValue([]);
    serverFns.getWhatsAppIntegrationStatus.mockResolvedValue(notConnected);
    renderInbox();

    expect(await screen.findByText(/WhatsApp setup is incomplete/i)).toBeTruthy();
    expect(screen.queryByText(EMPTY_INBOX_MESSAGE)).toBeNull();
  });

  it("does not claim the inbox is empty when the connection state is unknown", async () => {
    // The status query is the screen's evidence that an empty list means "nothing
    // arrived". If that query fails there is no evidence, and treating unknown as
    // connected reinstates exactly the claim this screen exists to avoid.
    serverFns.listWhatsAppConversations.mockResolvedValue([]);
    serverFns.getWhatsAppIntegrationStatus.mockRejectedValue(new Error("status boom"));
    renderInbox();

    await screen.findByRole("alert");

    expect(screen.queryByText(EMPTY_INBOX_MESSAGE)).toBeNull();
  });

  it("surfaces the failure when the connection state cannot be checked", async () => {
    serverFns.listWhatsAppConversations.mockResolvedValue([makeConversation()]);
    serverFns.getWhatsAppIntegrationStatus.mockRejectedValue(new Error("status boom"));
    renderInbox();

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("status boom"),
    );
  });

  it("names simulated delivery instead of reporting an empty inbox", async () => {
    // No external message is sent or received in simulated mode, so nothing is
    // recorded — the sibling automation screen says so and this one must agree.
    serverFns.listWhatsAppConversations.mockResolvedValue([]);
    serverFns.getWhatsAppIntegrationStatus.mockResolvedValue({
      ...connected,
      provider: "simulated",
      deliveryMode: "simulated",
      liveSendConfigured: false,
    });
    renderInbox();

    expect(await screen.findByText("Demo simulation")).toBeTruthy();
    expect(screen.queryByText(EMPTY_INBOX_MESSAGE)).toBeNull();
  });

  it("keeps a dropped selection visible instead of swapping in another client", async () => {
    serverFns.listWhatsAppConversations.mockResolvedValue([
      makeConversation(),
      makeConversation({ contactId: "44444444-4444-4444-8444-444444444444", displayName: "Bo Ng" }),
    ]);
    // Deliberately ONE client held across the refetch. Handing the provider a new
    // QueryClient empties the cache, so the list is briefly empty and `?? [0]`
    // yields undefined too — the assertion below would then hold either way.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ProductionWhatsAppInbox />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Bo Ng/ }));
    expect(await screen.findByRole("heading", { name: "Bo Ng" })).toBeTruthy();

    // Bo Ng falls off the refreshed page while Ada Wong stays, so a fallback to
    // the first conversation would be plainly visible.
    serverFns.listWhatsAppConversations.mockResolvedValue([makeConversation()]);
    await act(() => client.refetchQueries({ queryKey: ["whatsapp-conversations"] }));

    // Awaited, not read synchronously: if the refetch has not propagated yet the
    // pane still shows Bo Ng, and the "Ada Wong" assertion below would pass for
    // the wrong reason.
    expect(await screen.findByText(/no longer in this page/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Ada Wong" })).toBeNull();
  });

  it("can recover from a dropped selection without a reload", async () => {
    serverFns.listWhatsAppConversations.mockResolvedValue([
      makeConversation(),
      makeConversation({ contactId: "44444444-4444-4444-8444-444444444444", displayName: "Bo Ng" }),
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ProductionWhatsAppInbox />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Bo Ng/ }));
    serverFns.listWhatsAppConversations.mockResolvedValue([makeConversation()]);
    await act(() => client.refetchQueries({ queryKey: ["whatsapp-conversations"] }));

    fireEvent.click(await screen.findByRole("button", { name: "Show the newest conversation" }));

    expect(await screen.findByRole("heading", { name: "Ada Wong" })).toBeTruthy();
  });

  it("still shows the empty state when the provider is connected and nothing has arrived", async () => {
    serverFns.listWhatsAppConversations.mockResolvedValue([]);
    renderInbox();

    expect(await screen.findByText(EMPTY_INBOX_MESSAGE)).toBeTruthy();
  });

  it("names the missing bindings without printing their values", async () => {
    serverFns.listWhatsAppConversations.mockResolvedValue([]);
    serverFns.getWhatsAppIntegrationStatus.mockResolvedValue(notConnected);
    renderInbox();

    expect(await screen.findByText(/WOZTELL_ACCESS_TOKEN/)).toBeTruthy();
    expect(screen.getByText(/WOZTELL_WEBHOOK_SECRET/)).toBeTruthy();
  });

  it("offers no free-text composer", async () => {
    // Production sending is template-only — queueWhatsAppTemplateMessage requires a
    // template name, a category and a case id. A reply box here could not be wired
    // to anything, which is what made the demo one misleading.
    serverFns.listWhatsAppConversations.mockResolvedValue([makeConversation()]);
    const { container } = renderInbox();

    await screen.findByRole("heading", { name: "Ada Wong" });

    expect(container.querySelector("textarea")).toBeNull();
  });
});
