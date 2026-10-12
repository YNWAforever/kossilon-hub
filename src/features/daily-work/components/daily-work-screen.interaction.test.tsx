// @vitest-environment jsdom
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DailyWorkScreen } from "./daily-work-screen";
import { dailyWorkSearch, type DailyWorkSearch } from "../view-state";
const api = vi.hoisted(() => ({ page: vi.fn(), metrics: vi.fn() }));
vi.mock("../server-fns", () => ({
  listDailyWorkPage: api.page,
  getDailyAnnualReturnMetrics: api.metrics,
}));
const id = "11111111-1111-4111-8111-111111111111";
const ar = {
  workKey: "annual_return:" + id,
  sourceType: "annual_return",
  sourceId: id,
  companyId: id,
  companyName: "周年申報公司",
  dueDate: "2026-10-30",
  ownerName: "陳同事",
  blocker: "待安全覆核長原因，必須完整可讀",
  nextAction: { label: "開啟案件", href: "/annual-returns/" + id, enabled: true },
  updatedAt: "2026-10-12T00:00:00Z",
};
const inc = {
  ...ar,
  workKey: "incorporation:" + id,
  sourceType: "incorporation",
  companyId: null,
  companyName: "尚未成立公司",
  nextAction: { ...ar.nextAction, href: "/incorporation/" + id },
};
beforeEach(() => {
  api.page.mockResolvedValue({
    items: [ar, inc],
    total: 6,
    nextCursor: "owned-next",
    partial: false,
    businessDate: "2026-10-12",
    observedAt: "2026-10-12T00:00:00Z",
    sources: [
      { sourceType: "annual_return", status: "available", total: 2 },
      { sourceType: "incorporation", status: "available", total: 2 },
      { sourceType: "corporate_change_request", status: "available", total: 2 },
    ],
  });
  api.metrics.mockResolvedValue({
    chaseToday: 2,
    newlyReceived: 1,
    awaitingMyReview: 1,
    readyToFile: 0,
    returnsAndExceptions: 0,
  });
});
afterEach(cleanup);
function Harness() {
  const [search, setSearch] = useState<DailyWorkSearch>(dailyWorkSearch({}));
  return (
    <DailyWorkScreen
      actor={{
        userId: id,
        authUserId: "synthetic-component-only",
        role: "Manager",
        teamId: id,
        active: true,
      }}
      search={search}
      onSearchChange={setSearch}
    />
  );
}
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness />
    </QueryClientProvider>,
  );
}
it("renders mixed business next steps in default My work and preserves composite return state", async () => {
  mount();
  await screen.findByText("尚未成立公司");
  expect((screen.getByLabelText("工作範圍") as HTMLSelectElement).value).toBe("mine");
  expect(screen.getByText("周年申報公司").textContent).toBe("周年申報公司");
  const links = screen.getAllByRole("link", { name: "開啟案件" }),
    back = new URL(links[1].getAttribute("href")!, "https://local.invalid").searchParams.get(
      "returnTo",
    );
  expect(new URL(back!, "https://local.invalid").searchParams.get("anchor")).toBe(
    "incorporation:" + id,
  );
  expect(api.page).toHaveBeenCalledWith({
    data: expect.objectContaining({ scope: "mine", limit: 50 }),
  });
});
it("marks unavailable source/count as unknown without hiding available work or inventing zero", async () => {
  api.page.mockResolvedValue({
    items: [ar],
    total: 2,
    nextCursor: null,
    partial: true,
    businessDate: "2026-10-12",
    observedAt: "2026-10-12T00:00:00Z",
    sources: [
      { sourceType: "annual_return", status: "available", total: 2 },
      {
        sourceType: "incorporation",
        status: "unavailable",
        total: null,
        reason: "此業務尚未納入",
        supportId: "R15-local",
      },
    ],
  });
  mount();
  await screen.findByText("周年申報公司");
  expect(screen.getByRole("alert").textContent).toContain("未能完整取得");
  expect(screen.getByText(/公司註冊.*未知/).textContent).toContain("未知");
  expect(screen.queryByText("公司註冊 (0)")).toBeNull();
});
it("retains loaded data on next-page outage and gives retry/refresh", async () => {
  api.page.mockImplementation(async ({ data }) => {
    if (data.cursor) throw Error("offline");
    return {
      items: [ar],
      total: 100,
      nextCursor: "owned-next",
      partial: false,
      businessDate: "2026-10-12",
      observedAt: "2026-10-12T00:00:00Z",
      sources: [{ sourceType: "annual_return", status: "available", total: 100 }],
    };
  });
  mount();
  await screen.findByText("周年申報公司");
  fireEvent.click(screen.getByRole("button", { name: "下一頁工作" }));
  await screen.findByRole("alert");
  expect(screen.getByText("周年申報公司").textContent).toBe("周年申報公司");
  fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
  await waitFor(() => expect(api.page.mock.calls.filter((c) => c[0].data.cursor)).toHaveLength(2));
});
