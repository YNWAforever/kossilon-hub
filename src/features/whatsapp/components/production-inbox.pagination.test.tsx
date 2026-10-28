// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  conversations: vi.fn(),
  messages: vi.fn(),
  status: vi.fn(),
  actor: "A",
}));
vi.mock("../server-fns", () => ({
  listWhatsAppConversationPage: mocks.conversations,
  listWhatsAppConversationMessagePage: mocks.messages,
  listWhatsAppConversations: async () => (await mocks.conversations()).items,
  listWhatsAppConversationMessages: async () => (await mocks.messages()).items,
  getWhatsAppIntegrationStatus: mocks.status,
}));
vi.mock("@/features/auth/auth-context-neon", () => ({
  useAuth: () => ({ session: { id: mocks.actor, role: "Staff", team: "team" } }),
}));
vi.mock("./message-intake", () => ({ MessageIntake: () => null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: import("react").ReactNode }) => <a href="/">{children}</a>,
}));
import { ProductionWhatsAppInbox } from "./production-inbox";
const cursor = {
  at: "2026-10-01T00:00:00Z",
  id: "11111111-1111-4111-8111-111111111111",
  scope: "unit",
};
const conversation = (n: number) => ({
  contactId: `contact-${n}`,
  displayName: `Contact ${n}`,
  phoneE164: null,
  companyId: null,
  companyName: null,
  caseId: null,
  lastMessageBody: `Preview ${n}`,
  lastMessageDirection: "inbound",
  lastMessageAt: "2026-10-01T00:00:00Z",
});
const message = (n: number) => ({
  id: `message-${n}`,
  body: `Message ${n}`,
  direction: "outbound",
  status: "queued",
  attachments: [],
  caseId: null,
  sentAs: null,
  sentTemplateName: null,
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(),
  receivedAt: null,
  sentAt: null,
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ProductionWhatsAppInbox />
    </QueryClientProvider>,
  );
  return { client, ...view };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor = "A";
  mocks.conversations.mockResolvedValue({ items: [conversation(1)], nextCursor: null });
  mocks.messages.mockResolvedValue({ items: [message(201)], nextCursor: null });
  mocks.status.mockResolvedValue({ deliveryMode: "live", missingLiveEnvVars: [] });
});
afterEach(cleanup);
describe("WhatsApp complete history UI (unit)", () => {
  it("reaches conversation 101 without changing the selected conversation", async () => {
    mocks.conversations
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, n) => conversation(n + 1)),
        nextCursor: cursor,
      })
      .mockResolvedValueOnce({ items: [conversation(100), conversation(101)], nextCursor: null });
    mount();
    await screen.findByRole("heading", { name: "Contact 1" });
    fireEvent.click(screen.getByRole("button", { name: "載入更多對話" }));
    expect(await screen.findByRole("button", { name: /Contact 101/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Contact 100 / })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Contact 1" })).toBeTruthy();
    expect(mocks.conversations).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ cursor, limit: 100 }),
    });
  });
  it("reaches message 201, deduplicates overlaps, and preserves scroll on prepend and new arrivals", async () => {
    mocks.messages
      .mockResolvedValueOnce({
        items: Array.from({ length: 200 }, (_, n) => message(n + 2)),
        nextCursor: cursor,
      })
      .mockResolvedValueOnce({ items: [message(2), message(1)], nextCursor: null });
    const { client } = mount();
    await screen.findByText("Message 201");
    const region = screen.getByRole("region", { name: "對話訊息" });
    let height = 1000;
    Object.defineProperty(region, "scrollHeight", { configurable: true, get: () => height });
    region.scrollTop = 120;
    mocks.messages.mockReset().mockImplementation(async () => {
      height = 1080;
      return { items: [message(2), message(1)], nextCursor: null };
    });
    fireEvent.click(screen.getByRole("button", { name: "載入較舊訊息" }));
    await screen.findByText("Message 1");
    expect(screen.getAllByText("Message 2")).toHaveLength(1);
    expect(region.scrollTop).toBe(200);
    await act(() =>
      client.setQueriesData({ queryKey: ["whatsapp-conversation-messages"] }, (old: unknown) => {
        if (!old) return old;
        const data = old as {
          pages: { items: ReturnType<typeof message>[]; nextCursor: unknown }[];
        };
        return {
          ...data,
          pages: [
            { ...data.pages[0], items: [message(202), ...data.pages[0]!.items] },
            ...data.pages.slice(1),
          ],
        };
      }),
    );
    await screen.findByText("Message 202");
    expect(region.scrollTop).toBe(200);
  });
  it("keeps successful history on page failure and retries the failed page", async () => {
    mocks.messages
      .mockResolvedValueOnce({ items: [message(201)], nextCursor: cursor })
      .mockRejectedValueOnce(new Error("503 history"))
      .mockResolvedValueOnce({ items: [message(1)], nextCursor: null });
    mount();
    await screen.findByText("Message 201");
    fireEvent.click(screen.getByRole("button", { name: "載入較舊訊息" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Message 201")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重試較舊訊息" }));
    expect(await screen.findByText("Message 1")).toBeTruthy();
  });
  it("sends search to the server and resets old actor selection/history", async () => {
    const view = mount();
    await screen.findByRole("heading", { name: "Contact 1" });
    fireEvent.change(screen.getByRole("searchbox", { name: "搜尋對話" }), {
      target: { value: "中文公司" },
    });
    await waitFor(() =>
      expect(mocks.conversations).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ search: "中文公司" }),
      }),
    );
    mocks.actor = "B";
    mocks.conversations.mockResolvedValue({ items: [conversation(9)], nextCursor: null });
    mocks.messages.mockResolvedValue({ items: [message(9)], nextCursor: null });
    view.rerender(
      <QueryClientProvider client={view.client}>
        <ProductionWhatsAppInbox />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Contact 9" });
    expect(screen.queryByText("Message 201")).toBeNull();
    expect((screen.getByRole("searchbox", { name: "搜尋對話" }) as HTMLInputElement).value).toBe(
      "",
    );
  });
  it("does not switch the initial conversation when new activity reorders the rail", async () => {
    const { client } = mount();
    await screen.findByRole("heading", { name: "Contact 1" });
    mocks.conversations.mockResolvedValue({
      items: [conversation(9), conversation(1)],
      nextCursor: null,
    });
    await act(() => client.refetchQueries({ queryKey: ["whatsapp-conversations"] }));
    expect(screen.getByRole("heading", { name: "Contact 1" })).toBeTruthy();
  });

  it("keeps the selected conversation when a later conversation page fails and retries it", async () => {
    mocks.conversations
      .mockResolvedValueOnce({ items: [conversation(1)], nextCursor: cursor })
      .mockRejectedValueOnce(new Error("503 conversations"))
      .mockResolvedValueOnce({ items: [conversation(101)], nextCursor: null });
    mount();
    await screen.findByRole("heading", { name: "Contact 1" });
    fireEvent.click(screen.getByRole("button", { name: "載入更多對話" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", { name: "Contact 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重試更多對話" }));
    expect(await screen.findByRole("button", { name: /Contact 101/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Contact 1" })).toBeTruthy();
  });

  it("hides the prior company's messages while a newly selected thread loads", async () => {
    mocks.conversations.mockResolvedValue({
      items: [conversation(1), conversation(2)],
      nextCursor: null,
    });
    mount();
    await screen.findByText("Message 201");
    let finish!: (page: { items: ReturnType<typeof message>[]; nextCursor: null }) => void;
    mocks.messages.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Contact 2/ }));
    await waitFor(() => expect(screen.queryByText("Message 201")).toBeNull());
    expect(screen.getByRole("heading", { name: "Contact 2" })).toBeTruthy();
    await act(async () => {
      finish({ items: [message(2)], nextCursor: null });
    });
    expect(await screen.findByText("Message 2")).toBeTruthy();
  });
});
