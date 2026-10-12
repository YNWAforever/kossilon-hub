// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import type { BusinessListSearch } from "@/lib/business-list";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductionIncorporationList } from "./production-incorporation-list";
import { incorporationListPageSchema } from "../list-page";
const api = vi.hoisted(() => ({ page: vi.fn(), legacy: vi.fn(), options: vi.fn() }));
vi.mock("../server-fns", () => ({
  listIncorporationCasePage: api.page,
  listIncorporationCases: api.legacy,
}));
vi.mock("@/features/clients/server-fns", () => ({ listClientAssignmentOptions: api.options }));
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
  proposedCompanyNameEn: "首頁案件",
  proposedCompanyNameZh: null,
  proposedRegisteredOffice: "Test",
  proposedCompanySecretary: "Test",
  registeredCapital: 1000,
  businessNature: "Test",
  status: "Intake" as const,
  ownerId: owner,
  ownerName: "陳同事",
  teamId: team,
  teamName: "本隊",
  targetCompletionDate: "2026-10-30",
  dueDate: "2026-10-30",
  companyId: null,
  completedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
beforeEach(() => {
  api.legacy.mockResolvedValue([row]);
  api.page.mockImplementation(async ({ data }) => {
    if (data.cursor) throw Error("offline");
    return {
      items: [
        { ...row, proposedCompanyNameEn: data.q ? "尾頁中文案件" : row.proposedCompanyNameEn },
      ],
      total: 300,
      nextCursor: "next-owned",
      observedAt: "2026-10-12T00:00:00Z",
    };
  });
  api.options.mockResolvedValue({
    owners: [{ id: owner, name: "陳同事", teamId: team }],
    teams: [{ id: team, name: "本隊" }],
  });
});
afterEach(cleanup);
function Harness({ q = "" }: { q?: string }) {
  const [search, setSearch] = useState<BusinessListSearch>(
    incorporationListPageSchema.parse({ q }),
  );
  return (
    <ProductionIncorporationList
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
it("restores global list search and sends filters to the server rather than filtering the loaded50", async () => {
  mount("中文");
  await screen.findByText("尾頁中文案件");
  expect((screen.getByLabelText("搜尋案件") as HTMLInputElement).value).toBe("中文");
  expect(api.page).toHaveBeenCalledWith({
    data: expect.objectContaining({ q: "中文", limit: 50 }),
  });
  const href = screen.getByRole("link", { name: "開啟案件" }).getAttribute("href");
  expect(decodeURIComponent(href!)).toContain("/incorporation?");
  expect(
    new URL(
      new URL(href!, "https://local.invalid").searchParams.get("returnTo")!,
      "https://local.invalid",
    ).searchParams.get("q"),
  ).toBe("中文");
});
it("retains loaded rows and offers retry after a next-page network failure", async () => {
  mount();
  await screen.findByText("首頁案件");
  fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
  await screen.findByRole("alert");
  expect(screen.getByText("首頁案件").textContent).toBe("首頁案件");
  expect((screen.getByRole("button", { name: "重試列表" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  expect(screen.getByText(/300/).textContent).toContain("篩選總數 300");
  await waitFor(() =>
    expect(api.page).toHaveBeenCalledWith({
      data: expect.objectContaining({ cursor: "next-owned" }),
    }),
  );
});
