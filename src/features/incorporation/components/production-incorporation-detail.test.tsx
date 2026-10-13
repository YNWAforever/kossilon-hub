// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductionIncorporationDetail } from "./production-incorporation-detail";

const serverFns = vi.hoisted(() => ({
  completeIncorporationCase: vi.fn(),
  getIncorporationCase: vi.fn(),
  updateIncorporationCaseStatus: vi.fn(),
  updateIncorporationChecklistItem: vi.fn(),
}));

vi.mock("../server-fns", () => serverFns);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/incorporation">{children}</a>,
  useNavigate: () => vi.fn(),
}));

const caseId = "11111111-1111-4111-8111-111111111111";

function renderDetail(id = caseId) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionIncorporationDetail caseId={id} />
    </QueryClientProvider>,
  );
}

describe("ProductionIncorporationDetail", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("treats a malformed link as not found without asking the server", () => {
    renderDetail("not-a-case");

    expect(screen.getByRole("heading", { name: "找不到公司註冊案件" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回公司註冊" })).toBeTruthy();
    expect(serverFns.getIncorporationCase).not.toHaveBeenCalled();
  });

  it("says a case that does not exist is not found, not temporarily unavailable", async () => {
    serverFns.getIncorporationCase.mockResolvedValue(null);
    renderDetail();

    expect(await screen.findByRole("heading", { name: "找不到公司註冊案件" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重試" })).toBeNull();
  });

  it("offers a retry when the case fails to load", async () => {
    serverFns.getIncorporationCase.mockRejectedValue(new Error("connect ECONNREFUSED"));
    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("案件資料暫時無法載入，請稍後再試。");
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    await waitFor(() => expect(serverFns.getIncorporationCase).toHaveBeenCalledTimes(2));
  });
});
