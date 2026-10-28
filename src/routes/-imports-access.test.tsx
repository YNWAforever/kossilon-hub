// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense, type ComponentType } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
const mocks = vi.hoisted(() => ({
  role: "Manager",
  active: true,
  list: vi.fn(),
  options: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({
      dataMode: "production",
      actor: {
        authUserId: "unit",
        userId: "unit",
        role: mocks.role,
        teamId: "team",
        active: mocks.active,
      },
    }),
  }),
}));
vi.mock("@/features/nar-import/server-fns", () => ({
  listNarImportBatches: mocks.list,
  getNarApplyOptions: mocks.options,
  getNarImportBatchReview: vi.fn(),
  confirmNarBatchYear: vi.fn(),
  mapNarImportCompany: vi.fn(),
  stageNarImportBatch: vi.fn(),
}));
vi.mock("@/features/nar-import/apply-panel", () => ({ NarApplyPanel: () => null }));
import { Route } from "./imports";
const Imports = Route.options.component as ComponentType;
function ImportEntry() {
  return (
    <Suspense fallback={<p>載入中</p>}>
      <Imports />
    </Suspense>
  );
}
async function mountImport() {
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportEntry />
      </QueryClientProvider>,
    );
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active = true;
  mocks.list.mockResolvedValue([]);
  mocks.options.mockResolvedValue({ companies: [] });
});
afterEach(cleanup);
it.each(["Manager", "Staff", "Client"])(
  "blocks %s import deep links without any read",
  async (role) => {
    mocks.role = role;
    await mountImport();
    expect(
      await screen.findByText("只有已核實的在職管理員可以覆核跨公司月表。", {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.options).not.toHaveBeenCalled();
  },
);
it("retains the active Admin read-only import entry", async () => {
  mocks.role = "Admin";
  await mountImport();
  await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
  expect(await screen.findByText("之前的匯入")).toBeTruthy();
});
it("blocks an inactive Admin before import reads", async () => {
  mocks.role = "Admin";
  mocks.active = false;
  await mountImport();
  expect(await screen.findByText("只有已核實的在職管理員可以覆核跨公司月表。")).toBeTruthy();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.options).not.toHaveBeenCalled();
});

// Test the existing server read authority separately from the rendered guard.
it("keeps the backend batch-review policy Admin-only", async () => {
  const actual = await vi.importActual<typeof import("@/features/nar-import/server-fns")>(
    "@/features/nar-import/server-fns",
  );
  const actor: AuthenticatedActor = {
    authUserId: "unit",
    userId: "unit",
    role: "Manager",
    teamId: "team",
    active: true,
  };
  const repository = { getBatch: vi.fn(), listRows: vi.fn(), countByDisposition: vi.fn() };
  await expect(
    actual.getNarImportBatchReviewForActor(
      actor,
      { batchId: "unit" },
      { repository: repository as never },
    ),
  ).rejects.toThrow(/Admin/);
  expect(repository.getBatch).not.toHaveBeenCalled();
});
