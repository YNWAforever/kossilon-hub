// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionFollowUpDraft } from "../follow-ups";
import { ProductionWhatsAppAutomation } from "./production-whatsapp-automation";

const serverFns = vi.hoisted(() => ({
  listProductionFollowUpDrafts: vi.fn(),
  sendProductionFollowUp: vi.fn(),
}));

const whatsAppServerFns = vi.hoisted(() => ({
  getWhatsAppIntegrationStatus: vi.fn(),
}));

vi.mock("../follow-up-server-fns", () => serverFns);
vi.mock("@/features/whatsapp/server-fns", () => whatsAppServerFns);

const caseId = "11111111-1111-4111-8111-111111111111";
const drafts: ProductionFollowUpDraft[] = [
  {
    version: "owned-annual-preview",
    id: caseId,
    entityId: caseId,
    source: "annual-return",
    caseId,
    companyId: "22222222-2222-4222-8222-222222222222",
    companyName: "Acme Company Limited",
    ownerName: "Ada Chan",
    recipientName: "Chris Client",
    phone: "+85291234567",
    reasonLabel: "Annual return follow-up",
    messagePreview: "Please provide the outstanding annual return items.",
    status: "draft",
  },
  {
    version: "owned-document-preview",
    id: "33333333-3333-4333-8333-333333333333",
    entityId: "33333333-3333-4333-8333-333333333333",
    source: "document-review",
    caseId,
    companyId: "22222222-2222-4222-8222-222222222222",
    companyName: "Acme Company Limited",
    ownerName: "Ada Chan",
    recipientName: "Chris Client",
    phone: "+85291234567",
    reasonLabel: "Photo page is cropped.",
    messagePreview: "Please replace passport.pdf.",
    status: "draft",
  },
  {
    version: "owned-payment-preview",
    id: "44444444-4444-4444-8444-444444444444",
    entityId: "44444444-4444-4444-8444-444444444444",
    source: "payment-proof-review",
    caseId,
    companyId: "22222222-2222-4222-8222-222222222222",
    companyName: "Acme Company Limited",
    ownerName: "Ada Chan",
    recipientName: "Chris Client",
    phone: "+85291234567",
    reasonLabel: "Transaction reference is missing.",
    messagePreview: "Please replace payment-proof.pdf.",
    status: "draft",
  },
];

function renderAutomation(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ProductionWhatsAppAutomation />
    </QueryClientProvider>,
  );
  return invalidateSpy;
}

beforeEach(() => {
  vi.clearAllMocks();
  serverFns.listProductionFollowUpDrafts.mockResolvedValue(drafts);
  serverFns.sendProductionFollowUp.mockResolvedValue({ replayed: false });
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockResolvedValue({
    provider: "simulated",
    deliveryMode: "simulated",
    webhookConfigured: false,
    liveSendConfigured: false,
    missingLiveEnvVars: [
      "WOZTELL_API_BASE_URL",
      "WOZTELL_ACCESS_TOKEN",
      "WOZTELL_CHANNEL_ID",
      "WOZTELL_WEBHOOK_SECRET",
    ],
  });
});

afterEach(cleanup);

describe("ProductionWhatsAppAutomation", () => {
  it("shows the full recipient and message before approval queues anything", async () => {
    serverFns.listProductionFollowUpDrafts.mockResolvedValue([drafts[0]]);
    renderAutomation();
    fireEvent.click(await screen.findByRole("button", { name: "預覽並批准" }));
    const preview = await screen.findByRole("dialog");
    expect(preview.textContent).toContain("+85291234567");
    expect(preview.textContent).toContain(drafts[0].messagePreview);
    expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "批准並加入隊列" }));
    await waitFor(() => expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(1));
  });
  it("renders the explicit demo notice and invokes durable actions for all three sources", async () => {
    const invalidateSpy = renderAutomation();
    expect(await screen.findByText("示範模擬")).toBeTruthy();
    expect(screen.getByText("不會向外發送任何 WhatsApp 或電郵訊息。")).toBeTruthy();

    const buttons = await screen.findAllByRole("button", { name: "預覽並批准" });
    expect(buttons).toHaveLength(3);

    for (const button of buttons) {
      fireEvent.click(button);
      fireEvent.click(await screen.findByRole("button", { name: "批准並加入隊列" }));
      await waitFor(() =>
        expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(buttons.indexOf(button) + 1),
      );
    }

    expect(serverFns.sendProductionFollowUp.mock.calls.map(([call]) => call)).toEqual(
      drafts.map((draft) => ({
        data: {
          source: draft.source,
          caseId: draft.caseId,
          entityId: draft.entityId,
          expectedVersion: draft.version,
        },
      })),
    );
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(6));
    expect(invalidateSpy.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: ["annual-returns", "notifications", "automation"] },
      { queryKey: ["annual-returns", "notifications", caseId] },
      { queryKey: ["annual-returns", "notifications", "automation"] },
      { queryKey: ["annual-returns", "notifications", caseId] },
      { queryKey: ["annual-returns", "notifications", "automation"] },
      { queryKey: ["annual-returns", "notifications", caseId] },
    ]);
  });

  it("renders persisted rows and invokes the durable action for all three sources", async () => {
    const invalidateSpy = renderAutomation();
    const buttons = await screen.findAllByRole("button", { name: "預覽並批准" });
    expect(buttons).toHaveLength(3);

    for (const button of buttons) {
      fireEvent.click(button);
      fireEvent.click(await screen.findByRole("button", { name: "批准並加入隊列" }));
      await waitFor(() =>
        expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(buttons.indexOf(button) + 1),
      );
    }

    expect(serverFns.sendProductionFollowUp.mock.calls.map(([call]) => call)).toEqual(
      drafts.map((draft) => ({
        data: {
          source: draft.source,
          caseId: draft.caseId,
          entityId: draft.entityId,
          expectedVersion: draft.version,
        },
      })),
    );
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(6));
    expect(invalidateSpy.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: ["annual-returns", "notifications", "automation"] },
      { queryKey: ["annual-returns", "notifications", caseId] },
      { queryKey: ["annual-returns", "notifications", "automation"] },
      { queryKey: ["annual-returns", "notifications", caseId] },
      { queryKey: ["annual-returns", "notifications", "automation"] },
      { queryKey: ["annual-returns", "notifications", caseId] },
    ]);
  });

  it("serializes queueing across rows and requires readback after mutation errors", async () => {
    let rejectSend!: (error: Error) => void;
    serverFns.sendProductionFollowUp.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    renderAutomation();
    const buttons = await screen.findAllByRole("button", { name: "預覽並批准" });
    fireEvent.click(buttons[1]);
    fireEvent.click(await screen.findByRole("button", { name: "批准並加入隊列" }));

    await waitFor(() => expect((buttons[1] as HTMLButtonElement).disabled).toBe(true));
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[2] as HTMLButtonElement).disabled).toBe(true);

    await act(async () => rejectSend(new Error("Unable to queue follow-up.")));
    await screen.findByRole("button", { name: "重新核對跟進結果" });
    expect(screen.queryByText("Unable to queue follow-up.")).toBeNull();
  });
});

it("retries a failed draft read once while pending without invoking queue writes", async () => {
  serverFns.listProductionFollowUpDrafts.mockRejectedValue(new Error("private SQL failure"));
  renderAutomation();
  const retry = await screen.findByRole("button", { name: "重新載入跟進" });
  expect(screen.queryByText("沒有待處理的跟進。")).toBeNull();
  expect(screen.queryByText("private SQL failure")).toBeNull();
  let resolve!: (value: unknown) => void;
  serverFns.listProductionFollowUpDrafts.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(serverFns.listProductionFollowUpDrafts).toHaveBeenCalledTimes(2));
  expect(
    (screen.queryByRole("button", { name: "重新載入跟進" }) as HTMLButtonElement | null)
      ?.disabled ?? true,
  ).toBe(true);
  await act(async () => resolve([]));
  await screen.findByText("沒有待處理的跟進。");
  expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
  expect(whatsAppServerFns.getWhatsAppIntegrationStatus).toHaveBeenCalledTimes(1);
});

it("keeps an old preview blocked after a denied refresh and requires the fresh version to be reviewed", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  serverFns.listProductionFollowUpDrafts.mockResolvedValue([drafts[0]]);
  renderAutomation(client);
  fireEvent.click(await screen.findByRole("button", { name: "預覽並批准" }));
  let rejectRead!: (error: Error) => void;
  serverFns.listProductionFollowUpDrafts.mockImplementationOnce(
    () =>
      new Promise((_done, reject) => {
        rejectRead = reject;
      }),
  );
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = client.refetchQueries({
      queryKey: ["annual-returns", "notifications", "automation"],
    });
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "批准並加入隊列" }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  expect(screen.queryByText(drafts[0].messagePreview)).toBeNull();
  await act(async () => {
    rejectRead(new Error("private scope denied"));
    await refreshing;
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "批准並加入隊列" }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  expect(screen.queryByText(drafts[0].messagePreview)).toBeNull();
  const fresh = { ...drafts[0], version: "fresh-version", messagePreview: "Fresh approved draft" };
  serverFns.listProductionFollowUpDrafts.mockResolvedValue([fresh]);
  fireEvent.click(screen.getByRole("button", { name: "重新載入跟進" }));
  const review = await screen.findByRole("button", { name: "重新查看目前草稿" });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "批准並加入隊列" }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
  fireEvent.click(review);
  await screen.findAllByText("Fresh approved draft");
  fireEvent.click(screen.getByRole("button", { name: "批准並加入隊列" }));
  await waitFor(() => expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(1));
  expect(serverFns.sendProductionFollowUp.mock.calls[0][0]).toEqual({
    data: {
      source: fresh.source,
      caseId,
      entityId: fresh.entityId,
      expectedVersion: "fresh-version",
    },
  });
});

it.each([{ fresh: [] }, { fresh: [{ ...drafts[0], status: "queued" }] }])(
  "keeps removed or non-draft refreshed previews closed to approval",
  async ({ fresh }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    serverFns.listProductionFollowUpDrafts.mockResolvedValue([drafts[0]]);
    renderAutomation(client);
    fireEvent.click(await screen.findByRole("button", { name: "預覽並批准" }));
    serverFns.listProductionFollowUpDrafts.mockResolvedValue(fresh);
    await act(async () => {
      await client.refetchQueries({ queryKey: ["annual-returns", "notifications", "automation"] });
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "批准並加入隊列" }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(screen.queryByRole("button", { name: "重新查看目前草稿" })).toBeNull();
    expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
  },
);

async function failAutomationSend(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 2, retryDelay: 0 } },
  }),
) {
  serverFns.listProductionFollowUpDrafts.mockResolvedValue([drafts[0]]);
  serverFns.sendProductionFollowUp.mockRejectedValue(new Error("private unknown queue result"));
  renderAutomation(client);
  fireEvent.click(await screen.findByRole("button", { name: "預覽並批准" }));
  const submit = screen.getByRole("button", { name: "批准並加入隊列" });
  act(() => {
    submit.click();
    submit.click();
  });
  await screen.findByRole("button", { name: "重新核對跟進結果" });
  return client;
}

it.each(["queued", "unknown", "failed"] as const)(
  "reads back uncertain send as %s without queue replay",
  async (status) => {
    await failAutomationSend();
    expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "預覽並批准" })).toBeNull();
    serverFns.listProductionFollowUpDrafts.mockResolvedValue([{ ...drafts[0], status }]);
    fireEvent.click(screen.getByRole("button", { name: "重新核對跟進結果" }));
    await screen.findByText("已重新核對跟進狀態。請先核對清單，沒有重新加入隊列。");
    expect(screen.queryByRole("button", { name: "預覽並批准" })).toBeNull();
    expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("private unknown queue result")).toBeNull();
  },
);

it("keeps automation writes blocked through cache changes and permits only a fresh explicit approval", async () => {
  const client = await failAutomationSend();
  let resolve!: (value: unknown) => void;
  serverFns.listProductionFollowUpDrafts.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const retry = screen.getByRole("button", { name: "重新核對跟進結果" });
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(serverFns.listProductionFollowUpDrafts).toHaveBeenCalledTimes(2));
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    await client.cancelQueries();
    for (const query of client
      .getQueryCache()
      .findAll({ queryKey: ["annual-returns", "notifications", "automation"] }))
      client.setQueryData(query.queryKey, [drafts[0]]);
  });
  expect(screen.queryByRole("button", { name: "預覽並批准" })).toBeNull();
  const fresh = {
    ...drafts[0],
    version: "reconciled-version",
    messagePreview: "Reconciled current draft",
  };
  await act(async () => resolve([fresh]));
  fireEvent.click(await screen.findByRole("button", { name: "預覽並批准" }));
  await screen.findAllByText("Reconciled current draft");
  expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(1);
  serverFns.sendProductionFollowUp.mockResolvedValue({ replayed: false });
  fireEvent.click(screen.getByRole("button", { name: "批准並加入隊列" }));
  await waitFor(() => expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(2));
  expect(serverFns.sendProductionFollowUp.mock.calls[1][0]).toEqual({
    data: {
      source: fresh.source,
      caseId,
      entityId: fresh.entityId,
      expectedVersion: "reconciled-version",
    },
  });
});

it.each([{ fresh: null }, { fresh: [] }, { fresh: [{ ...drafts[0], version: "" }] }])(
  "keeps unavailable automation result readback blocked: %j",
  async ({ fresh }) => {
    await failAutomationSend();
    serverFns.listProductionFollowUpDrafts.mockResolvedValue(fresh);
    fireEvent.click(screen.getByRole("button", { name: "重新核對跟進結果" }));
    await screen.findByText("未能核實跟進結果，請稍後重新核對；沒有重試寫入。");
    expect(screen.queryByRole("button", { name: "預覽並批准" })).toBeNull();
    expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(1);
  },
);

it("retains uncertainty after ordinary background draft success", async () => {
  const client = await failAutomationSend();
  await act(async () => {
    await client.refetchQueries({ queryKey: ["annual-returns", "notifications", "automation"] });
  });
  expect(screen.getByRole("button", { name: "重新核對跟進結果" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "預覽並批准" })).toBeNull();
  expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(1);
});

it("allows a read-only retry after denied result readback", async () => {
  await failAutomationSend();
  serverFns.listProductionFollowUpDrafts.mockRejectedValueOnce(new Error("private read failure"));
  fireEvent.click(screen.getByRole("button", { name: "重新核對跟進結果" }));
  await screen.findByText("未能核實跟進結果，請稍後重新核對；沒有重試寫入。");
  expect(screen.queryByText("private read failure")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新核對跟進結果" }));
  await screen.findByRole("button", { name: "預覽並批准" });
  expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(1);
});

it("discards uncertain-send readback after leaving the actor session", async () => {
  const client = await failAutomationSend();
  let resolve!: (value: unknown) => void;
  serverFns.listProductionFollowUpDrafts.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "重新核對跟進結果" }));
  await waitFor(() => expect(serverFns.listProductionFollowUpDrafts).toHaveBeenCalledTimes(2));
  const before = client.getQueriesData({
    queryKey: ["annual-returns", "notifications", "automation"],
  });
  cleanup();
  await act(async () => resolve([{ ...drafts[0], status: "queued" }]));
  expect(
    client.getQueriesData({ queryKey: ["annual-returns", "notifications", "automation"] }),
  ).toEqual(before);
});

it("retries integration metadata once while pending without draft reload or queue replay", async () => {
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockRejectedValue(
    new Error("private metadata failure"),
  );
  renderAutomation();
  const retry = await screen.findByRole("button", { name: "重新讀取通訊設定" });
  expect(screen.queryByText("private metadata failure")).toBeNull();
  let resolve!: (value: unknown) => void;
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() =>
    expect(whatsAppServerFns.getWhatsAppIntegrationStatus).toHaveBeenCalledTimes(2),
  );
  expect(
    (screen.queryByRole("button", { name: "重新讀取通訊設定" }) as HTMLButtonElement | null)
      ?.disabled ?? true,
  ).toBe(true);
  await act(async () => resolve({ deliveryMode: "simulated", verificationStatus: "not_verified" }));
  await screen.findByText("示範模擬");
  expect(serverFns.listProductionFollowUpDrafts).toHaveBeenCalledTimes(1);
  expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
});

it("hides cached simulated metadata after denial and never calls fresh live configuration verified", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderAutomation(client);
  await screen.findByText("示範模擬");
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockRejectedValue(new Error("denied"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["whatsapp-integration-status"] });
  });
  await screen.findByRole("button", { name: "重新讀取通訊設定" });
  expect(screen.queryByText("示範模擬")).toBeNull();
  expect(screen.queryByText("不會向外發送任何 WhatsApp 或電郵訊息。")).toBeNull();
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockResolvedValue({
    deliveryMode: "live",
    verificationStatus: "not_verified",
  });
  fireEvent.click(screen.getByRole("button", { name: "重新讀取通訊設定" }));
  await waitFor(() =>
    expect(client.getQueryState(["whatsapp-integration-status"])?.fetchStatus).toBe("idle"),
  );
  expect(screen.queryByText("示範模擬")).toBeNull();
  for (const label of ["連線正常", "驗證成功", "PASS"])
    expect(screen.queryByText(label)).toBeNull();
  expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
});

it("offers integration retry inside an open preview without discarding or submitting its draft", async () => {
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockRejectedValue(
    new Error("configuration read failed"),
  );
  serverFns.listProductionFollowUpDrafts.mockResolvedValue([drafts[0]]);
  renderAutomation();
  fireEvent.click(await screen.findByRole("button", { name: "預覽並批准" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain(drafts[0].messagePreview);
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockResolvedValue({
    deliveryMode: "blocked",
    verificationStatus: "not_verified",
  });
  fireEvent.click(screen.getByRole("button", { name: "重新讀取通訊設定" }));
  await waitFor(() =>
    expect(whatsAppServerFns.getWhatsAppIntegrationStatus).toHaveBeenCalledTimes(2),
  );
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(dialog.textContent).toContain(drafts[0].messagePreview);
  expect(serverFns.listProductionFollowUpDrafts).toHaveBeenCalledTimes(1);
  expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
});

it("keeps repeated integration failure recoverable with generic errors", async () => {
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockRejectedValue(
    new Error("secret metadata details"),
  );
  renderAutomation();
  fireEvent.click(await screen.findByRole("button", { name: "重新讀取通訊設定" }));
  await waitFor(() =>
    expect(whatsAppServerFns.getWhatsAppIntegrationStatus).toHaveBeenCalledTimes(2),
  );
  await screen.findByRole("button", { name: "重新讀取通訊設定" });
  expect(screen.queryByText("secret metadata details")).toBeNull();
  expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
});

it("does not clear uncertain-send admission by refreshing integration metadata", async () => {
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockRejectedValue(
    new Error("metadata unavailable"),
  );
  await failAutomationSend();
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockResolvedValue({
    deliveryMode: "live",
    verificationStatus: "not_verified",
  });
  fireEvent.click(screen.getByRole("button", { name: "重新讀取通訊設定" }));
  await waitFor(() =>
    expect(whatsAppServerFns.getWhatsAppIntegrationStatus).toHaveBeenCalledTimes(2),
  );
  expect(screen.getByRole("button", { name: "重新核對跟進結果" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "預覽並批准" })).toBeNull();
  expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(1);
});
