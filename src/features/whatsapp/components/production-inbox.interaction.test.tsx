// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WhatsAppConversation } from "../conversations";
import { ProductionWhatsAppInbox } from "./production-inbox";

const serverFns = vi.hoisted(() => ({
  listWhatsAppConversations: vi.fn(),
  listWhatsAppConversationMessages: vi.fn(),
  getWhatsAppIntegrationStatus: vi.fn(),
}));

vi.mock("../server-fns", () => serverFns);
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/annual-returns">{children}</a>,
}));

const contactId = "11111111-1111-4111-8111-111111111111";

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

    expect(screen.queryByText("No WhatsApp conversations have been received yet.")).toBeNull();
  });

  it("says the provider is not connected instead of showing an empty inbox", async () => {
    // With no Woztell credentials the webhook cannot verify a signature, so
    // whatsapp_messages is guaranteed empty. Reporting that as "no conversations
    // yet" would read as "no client has messaged us", which is a different claim.
    serverFns.listWhatsAppConversations.mockResolvedValue([]);
    serverFns.getWhatsAppIntegrationStatus.mockResolvedValue(notConnected);
    renderInbox();

    expect(await screen.findByText(/WhatsApp is not connected/i)).toBeTruthy();
    expect(screen.queryByText("No WhatsApp conversations have been received yet.")).toBeNull();
  });

  it("still shows the empty state when the provider is connected and nothing has arrived", async () => {
    serverFns.listWhatsAppConversations.mockResolvedValue([]);
    renderInbox();

    expect(
      await screen.findByText("No WhatsApp conversations have been received yet."),
    ).toBeTruthy();
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
