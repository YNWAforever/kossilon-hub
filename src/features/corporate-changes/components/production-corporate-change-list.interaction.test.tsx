// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import type { BusinessListSearch } from "@/lib/business-list";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductionCorporateChangeList } from "./production-corporate-change-list";
import { corporateChangeListPageSchema } from "../list-page";
const api = vi.hoisted(() => ({
  page: vi.fn(),
  legacy: vi.fn(),
  clients: vi.fn(),
  options: vi.fn(),
}));
vi.mock("../server-fns", () => ({
  listCorporateChangeRequestPage: api.page,
  listCorporateChangeRequests: api.legacy,
  createCorporateChangeRequest: vi.fn(),
}));
vi.mock("@/features/clients/server-fns", () => ({
  listClientPage: api.clients,
  listClientAssignmentOptions: api.options,
  getClient: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: ReactNode;
    to: string;
    params?: { id: string };
    search?: { returnTo?: string };
  }) => (
    <a
      href={
        to.replace("$id", params?.id ?? "") +
        (search?.returnTo ? "?returnTo=" + encodeURIComponent(search.returnTo) : "")
      }
    >
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));
const id = "11111111-1111-4111-8111-111111111111",
  owner = "22222222-2222-4222-8222-222222222222",
  team = "33333333-3333-4333-8333-333333333333";
const row = {
  id,
  companyId: id,
  companyName: "首頁公司",
  changeType: "name_change",
  status: "Requested",
  ownerId: owner,
  ownerName: "陳同事",
  quotedFee: 1200.25,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  dueDate: null,
};
beforeEach(() => {
  api.legacy.mockResolvedValue([row]);
  api.page.mockImplementation(async ({ data }) => ({
    items: [{ ...row, companyName: data.q ? "尾頁中文公司" : row.companyName }],
    total: 300,
    nextCursor: null,
    observedAt: "2026-10-12T00:00:00Z",
  }));
  api.clients.mockResolvedValue({
    clients: [{ id, companyName: "可選公司" }],
    total: 1,
    nextCursor: null,
  });
  api.options.mockResolvedValue({
    owners: [{ id: owner, name: "陳同事", teamId: team }],
    teams: [{ id: team, name: "本隊" }],
  });
});
afterEach(cleanup);
function Harness({ q = "" }: { q?: string }) {
  const [search, setSearch] = useState<BusinessListSearch>(
    corporateChangeListPageSchema.parse({ q }),
  );
  return (
    <ProductionCorporateChangeList
      search={search}
      onSearchChange={setSearch}
      actor={{ userId: owner, authUserId: "synthetic", role: "Staff", teamId: team, active: true }}
    />
  );
}
function mount(q = "") {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness q={q} />
    </QueryClientProvider>,
  );
}
it("searches actual requests globally and keeps company picker inside the create dialog", async () => {
  mount("中文");
  await screen.findByText("尾頁中文公司");
  expect((screen.getByLabelText("搜尋案件") as HTMLInputElement).value).toBe("中文");
  expect(screen.queryByLabelText("搜尋可選公司")).toBeNull();
  expect(api.page).toHaveBeenCalledWith({
    data: expect.objectContaining({ q: "中文", limit: 50 }),
  });
  fireEvent.click(screen.getByRole("button", { name: /新增變更|New request/ }));
  const dialog = await screen.findByRole("dialog");
  expect((within(dialog).getByLabelText("搜尋可選公司") as HTMLInputElement).value).toBe("");
  fireEvent.click(await within(dialog).findByRole("button", { name: /Cancel|取消/ }));
  expect(screen.getByText("尾頁中文公司").textContent).toBe("尾頁中文公司");
});
