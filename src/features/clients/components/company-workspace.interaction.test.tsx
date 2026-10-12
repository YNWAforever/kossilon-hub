// @vitest-environment jsdom
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { CompanyWorkspaceScreen } from "./company-workspace-screen";
import { companyWorkspaceSearch } from "../company-workspace-navigation";
const f = vi.hoisted(() => ({
  getCompanyWorkspaceSummary: vi.fn(),
  listCompanyWorkspaceCases: vi.fn(),
  listCompanyWorkspaceDocuments: vi.fn(),
  listCompanyWorkspacePayments: vi.fn(),
  listCompanyWorkspaceActivity: vi.fn(),
}));
vi.mock("../company-workspace-server-fns", () => f);
vi.mock("./production-client-detail", () => ({
  ProductionClientDetail: () => <p>可維護公司資料</p>,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("loads only the active bounded tab, keeps ID-specific metadata links and retains rows after an offline refresh", async () => {
  const companyId = "11111111-1111-4111-8111-111111111111",
    docId = "22222222-2222-4222-8222-222222222222";
  f.getCompanyWorkspaceSummary.mockResolvedValue({
    companyId,
    companyName: "同名公司",
    openCases: 2,
    documents: 1000,
    paymentCases: 1,
    outstandingAmount: "1200",
    partial: false,
    observedAt: "2026-10-12T00:00Z",
    scopeNotice: "授權範圍內摘要",
  });
  f.listCompanyWorkspaceDocuments.mockResolvedValue({
    items: [
      {
        id: docId,
        companyId,
        caseId: null,
        fileName: "同名文件.pdf",
        currentVersionId: null,
        reviewStatus: "pending",
      },
    ],
    total: 1000,
    nextCursor: "next",
    observedAt: "2026-10-12T00:00Z",
  });
  function Harness() {
    const [search, setSearch] = useState(companyWorkspaceSearch({}));
    return (
      <CompanyWorkspaceScreen companyId={companyId} search={search} onSearchChange={setSearch} />
    );
  }
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness />
    </QueryClientProvider>,
  );
  await screen.findByText("授權範圍內摘要");
  expect(f.listCompanyWorkspaceDocuments).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "文件" }));
  await screen.findByText("同名文件.pdf");
  const url = new URL(
    screen.getByRole("link", { name: "核對文件來源" }).getAttribute("href")!,
    "https://local.invalid",
  );
  expect(url.searchParams.get("documentId")).toBe(docId);
  expect(url.searchParams.get("companyId")).toBe(companyId);
  expect(url.searchParams.get("returnTo")).toContain("tab=documents");
  expect(screen.getByText(/只有登記資料/)).toBeTruthy();
  expect(f.listCompanyWorkspaceDocuments).toHaveBeenLastCalledWith({
    data: expect.objectContaining({ companyId, limit: 50 }),
  });
  f.listCompanyWorkspaceDocuments.mockRejectedValue(Error("SECRET SQL"));
  fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
  await screen.findByRole("alert");
  expect(screen.getByText("同名文件.pdf")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).not.toContain("SECRET");
  fireEvent.click(screen.getByRole("button", { name: "工作" }));
  await waitFor(() =>
    expect(f.listCompanyWorkspaceCases).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId, cursor: undefined }),
    }),
  );
});
