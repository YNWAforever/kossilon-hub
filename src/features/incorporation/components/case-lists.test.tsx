// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  search: "",
  navigate: vi.fn(),
  incorporation: vi.fn(),
  changes: vi.fn(),
  picker: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useRouter: () => ({ navigate: state.navigate }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: state.search } }),
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
        (search?.returnTo ? `?returnTo=${encodeURIComponent(search.returnTo)}` : "")
      }
    >
      {children}
    </a>
  ),
}));
vi.mock("../server-fns", () => ({
  listIncorporationCases: async () => [],
  listIncorporationCasePage: state.incorporation,
}));
vi.mock("@/features/corporate-changes/server-fns", () => ({
  listCorporateChangeRequests: async () => [],
  listCorporateChangeRequestPage: state.changes,
}));
vi.mock("@/features/clients/server-fns", () => ({
  listClientPage: state.picker,
  listClientAssignmentOptions: async () => ({ owners: [], teams: [] }),
}));
vi.mock("@/components/incorporation/create-incorporation-case-dialog", () => ({
  CreateIncorporationCaseDialog: () => null,
}));
vi.mock("@/components/corporate-changes/create-corporate-change-request-dialog", () => ({
  CreateCorporateChangeRequestDialog: () => null,
}));
import { ProductionIncorporationList } from "./production-incorporation-list";
import { ProductionCorporateChangeList } from "@/features/corporate-changes/components/production-corporate-change-list";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.search = "";
  state.incorporation.mockReset();
  state.changes.mockReset();
  state.picker.mockReset();
  state.incorporation.mockResolvedValue({ items: [], nextCursor: null });
  state.changes.mockResolvedValue({ items: [], nextCursor: null });
  state.picker.mockResolvedValue({ clients: [], nextCursor: null });
});
for (const [name, Component, path] of [
  ["incorporation", ProductionIncorporationList, "/incorporation"],
  ["corporate changes", ProductionCorporateChangeList, "/corporate-changes"],
] as const)
  describe(name, () => {
    function mount() {
      return render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Component />
        </QueryClientProvider>,
      );
    }
    it("searches existing cases independently from the create company picker", async () => {
      mount();
      const search = await screen.findByLabelText("搜尋既有案件");
      fireEvent.change(search, { target: { value: "新創" } });
      fireEvent.submit(screen.getByRole("form", { name: "案件篩選" }));
      expect(state.navigate).toHaveBeenCalledWith({ href: expect.stringContaining(`${path}?q=`) });
      expect(state.navigate.mock.calls.at(-1)?.[0].href).toContain(encodeURIComponent("新創"));
      expect(screen.queryByLabelText("搜尋可選公司")).toBeNull();
    });
    it("restores filters from the URL and permits clearing a failed cursor", async () => {
      state.search = "?q=New&sort=company&cursor=invalid";
      (name === "incorporation" ? state.incorporation : state.changes).mockRejectedValue(
        new Error("Invalid cursor"),
      );
      mount();
      await screen.findByRole("alert");
      expect((screen.getByLabelText("搜尋既有案件") as HTMLInputElement).value).toBe("New");
      fireEvent.click(screen.getByRole("button", { name: "重新整理列表" }));
      expect(state.navigate).toHaveBeenCalledWith({ href: `${path}?q=New&sort=company` });
    });
    it("refetches a rejected first page and renders the second response when refresh is clicked", async () => {
      state.search = "?q=New&sort=company";
      const id = "10000000-0000-4000-8000-000000000001";
      const record =
        name === "incorporation"
          ? {
              id,
              proposedCompanyNameEn: "New Venture recovered",
              proposedCompanyNameZh: "新創公司",
              proposedRegisteredOffice: "Test office",
              proposedCompanySecretary: "Test secretary",
              registeredCapital: 10000,
              businessNature: "Testing",
              status: "Completed",
              ownerId: id,
              ownerName: "Staff A",
              teamId: id,
              teamName: "Team A",
              targetCompletionDate: "2026-11-01",
              companyId: id,
              completedAt: "2026-10-23T00:00:00Z",
              createdAt: "2026-10-23T00:00:00Z",
            }
          : {
              id,
              companyId: id,
              companyName: "New Venture recovered",
              changeType: "address_change",
              status: "Completed",
              ownerId: id,
              ownerName: "Staff A",
              dueDate: null,
              quotedFee: 1000,
              createdAt: "2026-10-23T00:00:00Z",
            };
      const api = name === "incorporation" ? state.incorporation : state.changes;
      api
        .mockRejectedValueOnce(new Error("temporary read failure"))
        .mockResolvedValueOnce({ items: [record], nextCursor: null });
      mount();
      await screen.findByRole("alert");
      expect(api).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "重新整理列表" }));
      await screen.findByText("New Venture recovered");
      expect(api).toHaveBeenCalledTimes(2);
      expect(api).toHaveBeenLastCalledWith({ data: { q: "New", sort: "company" } });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(state.navigate).not.toHaveBeenCalled();
    });
    it("requests URL filters, carries them to detail and advances using the returned cursor", async () => {
      state.search = "?q=New&sort=company";
      const id = "10000000-0000-4000-8000-000000000001";
      const record =
        name === "incorporation"
          ? {
              id,
              proposedCompanyNameEn: "New Venture",
              proposedCompanyNameZh: "新創公司",
              proposedRegisteredOffice: "Test office",
              proposedCompanySecretary: "Test secretary",
              registeredCapital: 10000,
              businessNature: "Testing",
              status: "Completed",
              ownerId: id,
              ownerName: "Staff A",
              teamId: id,
              teamName: "Team A",
              targetCompletionDate: "2026-11-01",
              companyId: id,
              completedAt: "2026-10-23T00:00:00Z",
              createdAt: "2026-10-23T00:00:00Z",
            }
          : {
              id,
              companyId: id,
              companyName: "New Venture",
              changeType: "address_change",
              status: "Completed",
              ownerId: id,
              ownerName: "Staff A",
              dueDate: null,
              quotedFee: 1000,
              createdAt: "2026-10-23T00:00:00Z",
            };
      const api = name === "incorporation" ? state.incorporation : state.changes;
      api.mockResolvedValue({ items: [record], nextCursor: "next-cursor" });
      mount();
      await screen.findByText("New Venture");
      expect(api).toHaveBeenCalledWith({ data: { q: "New", sort: "company" } });
      const link = screen
        .getAllByRole("link")
        .find((item) => item.getAttribute("href")?.startsWith(`${path}/${id}`));
      expect(link?.getAttribute("href")).toContain(
        encodeURIComponent(`${path}?q=New&sort=company`),
      );
      fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
      expect(state.navigate).toHaveBeenCalledWith({
        href: `${path}?q=New&sort=company&cursor=next-cursor`,
      });
    });
  });
