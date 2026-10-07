// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense } from "react";
import type { OperationsHealthView } from "@/features/operations/server-fns";

const state = vi.hoisted(() => ({ query: vi.fn(), dataMode: "production" }));
vi.mock("@/features/operations/server-fns", () => ({ getOperationsHealth: state.query }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ dataMode: state.dataMode }),
  }),
}));
import { Route } from "./operations";
const Page = Route.options.component!;
const instant = "2026-10-07T16:05:00.000Z";
const queue = {
  pending: 1,
  dueNow: 1,
  processing: 0,
  retrying: 0,
  failed: 0,
  oldestPendingAt: instant,
};
function view(): OperationsHealthView {
  return {
    schema: {
      state: "current",
      missing: [],
      ahead: [],
      appliedCount: 50,
      expectedCount: 50,
      summary: "結構一致",
    },
    releaseCompatibility: null,
    maintenance: {
      state: "healthy",
      lastRunAt: instant,
      lastSuccessAt: instant,
      lagSeconds: 0,
      toleranceSeconds: 600,
      failedPasses: [],
      summary: "排程按時執行",
    },
    recentRuns: [
      {
        id: "controlled-run",
        scheduledFor: instant,
        startedAt: instant,
        finishedAt: instant,
        durationMs: 1,
        outcome: "succeeded",
        failedPasses: [],
        dispatch: null,
        triggerSource: "scheduled",
        platformTriggerVerified: true,
      },
    ],
    queues: {
      documentScans: queue,
      documentAnalysis: { ...queue, oldestPendingAt: null },
      notifications: { ...queue, oldestPendingAt: null },
      handoffsAwaitingTransmission: 0,
    },
    blockedIntegrations: [],
    staleBlockers: [],
    capabilities: [
      {
        id: "database",
        capability: "受控資料庫",
        implemented: true,
        configured: true,
        health: "healthy",
        lastVerifiedAt: instant,
        approvalRequired: true,
        owner: "DB owner",
        nextAction: "核對",
        summary: "已記錄驗證",
      },
    ],
    lastSuccessLookupKnown: true,
    executionScope: "safe-maintenance-only",
    schedulerLeases: { startedUnknown: 0, claimedExpired: 0, lastStartedAt: null },
    diagnostics: null,
  };
}
let client: QueryClient;
beforeEach(() => {
  state.dataMode = "production";
  state.query.mockReset().mockResolvedValue(view());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  onlineManager.setOnline(true);
  vi.useRealTimers();
});
async function flush(ms = 1) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function mount() {
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={<p>Testing load</p>}>
          <Page />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  await screen.findByRole("heading", { name: "系統運作" });
}
async function startClock() {
  await screen.findByText("正常", { exact: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(instant));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["operations", "health"] });
  });
  await flush();
}

describe("Operations trustworthy observation", () => {
  it("labels and converts UTC run, queue and verification timestamps across HK midnight", async () => {
    await mount();
    await screen.findByText("正常", { exact: true });
    expect(screen.getByText(/香港時間/)).toBeTruthy();
    expect(screen.getAllByText("2026-10-08 00:05").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/最後驗證：2026-10-08 00:05/)).toBeTruthy();
    expect(screen.queryByText("2026-10-07 16:05")).toBeNull();
  });

  it("refreshes an open page and replaces a healthy result with the server's stale result", async () => {
    await mount();
    await startClock();
    const stale = view();
    stale.maintenance = { ...stale.maintenance!, state: "stale", summary: "最新排程已過期" };
    state.query.mockResolvedValue(stale);
    await flush(60_000);
    await flush();
    expect(screen.getByText("排程已停止")).toBeTruthy();
    expect(screen.queryByText("正常", { exact: true })).toBeNull();
  });

  it("hides cached green status after a refresh error and allows recovery", async () => {
    await mount();
    await startClock();
    state.query.mockRejectedValue(new Error("Controlled unavailable"));
    await flush(60_000);
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("無法載入");
    expect(screen.queryByText("正常", { exact: true })).toBeNull();
    state.query.mockResolvedValue(view());
    fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
    await flush();
    await flush();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("正常", { exact: true })).toBeTruthy();
  });

  it("shows pending state instead of an empty operational screen", async () => {
    state.query.mockImplementation(() => new Promise(() => {}));
    await mount();
    expect(screen.getByRole("status").textContent).toContain("正在載入");
    expect(screen.queryByText("正常", { exact: true })).toBeNull();
  });

  it("keeps cached green hidden while reconnect waits for a new response", async () => {
    await mount();
    await startClock();
    let resolveHealth!: (value: OperationsHealthView) => void;
    state.query.mockImplementation(
      () =>
        new Promise<OperationsHealthView>((resolve) => {
          resolveHealth = resolve;
        }),
    );
    await act(async () => {
      onlineManager.setOnline(false);
    });
    await flush(60_000);
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("連線暫停");
    expect(screen.queryByText("正常", { exact: true })).toBeNull();
    await act(async () => {
      onlineManager.setOnline(true);
    });
    await flush();
    expect(screen.queryByText("正常", { exact: true })).toBeNull();
    await act(async () => {
      resolveHealth(view());
    });
    await flush();
    expect(screen.getByText("正常", { exact: true })).toBeTruthy();
  });

  it("does not start a production health request in demo mode", async () => {
    state.dataMode = "demo";
    await mount();
    vi.useFakeTimers();
    await flush(120_000);
    expect(screen.getByText(/示範模式沒有排程/)).toBeTruthy();
    expect(state.query).not.toHaveBeenCalled();
  });
});
