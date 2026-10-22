// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ dataMode: "production", actor: { role: "Staff", active: true } }),
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../features/documents/server-fns", () => ({
  listDocumentPage: rpc.page,
  downloadDocument: vi.fn(),
}));
vi.mock("../features/annual-return/server-fns", () => ({
  listAnnualReturnCases: async () => [],
  getAnnualReturnCase: async () => null,
}));
import { Route } from "./documents";

afterEach(cleanup);

it("sends global filters to the RPC and restarts at page one after paging", async () => {
  rpc.page.mockImplementation(async ({ data }) => ({
    documents: [],
    nextCursor: data.cursor || data.q ? null : "next-page",
  }));
  const Component = Route.options.component!;
  await Component.preload?.();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Component />
      </QueryClientProvider>,
    );
  });
  fireEvent.click(await screen.findByRole("button", { name: "載入更多文件" }));
  await waitFor(() =>
    expect(rpc.page).toHaveBeenCalledWith({ data: { cursor: "next-page", limit: 100 } }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "搜尋正式文件" }), {
    target: { value: "needle" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "按類別篩選正式文件" }), {
    target: { value: "payment" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "按來源篩選正式文件" }), {
    target: { value: "client" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "按覆核狀態篩選正式文件" }), {
    target: { value: "pending" },
  });
  await waitFor(() =>
    expect(rpc.page).toHaveBeenLastCalledWith({
      data: {
        cursor: undefined,
        limit: 100,
        q: "needle",
        category: "payment",
        source: "client",
        reviewStatus: "pending",
      },
    }),
  );
});
