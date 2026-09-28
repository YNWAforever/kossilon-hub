// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionFollowUpDraft } from "../follow-ups";
import type { ProductionFollowUpPreview } from "../follow-up-preview";
import { ProductionWhatsAppAutomation } from "./production-whatsapp-automation";

const serverFns = vi.hoisted(() => ({
  listProductionFollowUpDrafts: vi.fn(),
  previewProductionFollowUp: vi.fn(),
  sendProductionFollowUp: vi.fn(),
}));
const whatsAppServerFns = vi.hoisted(() => ({ getWhatsAppIntegrationStatus: vi.fn() }));
vi.mock("../follow-up-server-fns", () => serverFns);
vi.mock("@/features/whatsapp/server-fns", () => whatsAppServerFns);
const bulkFns = vi.hoisted(() => ({
  previewBulkOperation: vi.fn(),
  commitBulkOperation: vi.fn(),
  getBulkOperation: vi.fn(),
}));
const reminderFns = vi.hoisted(() => ({
  getBulkReminderReview: vi.fn(),
  approveBulkReminderReview: vi.fn(),
  cancelBulkReminderReview: vi.fn(),
}));
vi.mock("@/features/bulk-operations/server-fns", () => bulkFns);
vi.mock("@/features/bulk-operations/reminder-server-fns", () => reminderFns);

const caseId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const base = {
  caseId,
  companyId,
  companyName: "Acme Company Limited",
  ownerName: "Ada Chan",
  recipientName: "Chris Client",
  phone: "+85291234567",
  status: "draft" as const,
};
const drafts: ProductionFollowUpDraft[] = [
  {
    ...base,
    id: caseId,
    entityId: caseId,
    source: "annual-return",
    reasonLabel: "Annual return follow-up",
    messagePreview: "Please provide the outstanding annual return items.",
  },
  {
    ...base,
    id: "33333333-3333-4333-8333-333333333333",
    entityId: "33333333-3333-4333-8333-333333333333",
    source: "document-review",
    reasonLabel: "Photo page is cropped.",
    messagePreview: "Please replace passport.pdf.",
  },
  {
    ...base,
    id: "44444444-4444-4444-8444-444444444444",
    entityId: "44444444-4444-4444-8444-444444444444",
    source: "payment-proof-review",
    reasonLabel: "Transaction reference is missing.",
    messagePreview: "Please replace payment-proof.pdf.",
  },
];
function previewFor(draft: ProductionFollowUpDraft): ProductionFollowUpPreview {
  return {
    identity: { source: draft.source, caseId: draft.caseId, entityId: draft.entityId },
    caseId: draft.caseId,
    companyId: draft.companyId,
    companyName: draft.companyName,
    contactId: "55555555-5555-4555-8555-555555555555",
    recipientName: draft.recipientName!,
    recipientE164: draft.phone!,
    languageCode: "en",
    renderedText: draft.messagePreview,
    sendMode: "text",
    templateName: null,
    components: [],
    lastInboundAt: "2026-09-27T08:00:00.000Z",
    contactVersion: "2026-09-27T08:00:00.000Z",
    previewHash: "a".repeat(64),
  };
}
function renderAutomation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ProductionWhatsAppAutomation />
    </QueryClientProvider>,
  );
  return invalidateSpy;
}
const healthy = {
  provider: "woztell",
  deliveryMode: "live",
  capabilityStatus: { state: "healthy" },
};
const simulated = {
  provider: "simulated",
  deliveryMode: "simulated",
  capabilityStatus: { state: "blocked" },
};

beforeEach(() => {
  vi.clearAllMocks();
  serverFns.listProductionFollowUpDrafts.mockResolvedValue({ drafts, nextCursor: null });
  serverFns.previewProductionFollowUp.mockImplementation(({ data }) => {
    const draft = drafts.find(
      (item) => item.source === data.source && item.entityId === data.entityId,
    );
    return Promise.resolve(previewFor(draft!));
  });
  serverFns.sendProductionFollowUp.mockResolvedValue({ replayed: false });
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockResolvedValue(healthy);
  bulkFns.previewBulkOperation.mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    previewHash: "b".repeat(64),
    action: "reminderDrafts",
    selectionCount: 1,
    eligibleCount: 1,
    skippedCount: 0,
    conflictCount: 0,
    expiresAt: "2099-01-01T00:00:00.000Z",
    itemsPreview: [
      {
        resourceId: caseId,
        revision: 1,
        state: "eligible",
        reasonCode: null,
        recipientName: "Chris Client",
        recipientE164: "+85291234567",
        renderedText: "Approved exact reminder template",
        sendMode: "template",
      },
    ],
  });
  bulkFns.commitBulkOperation.mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" });
  bulkFns.getBulkOperation.mockResolvedValue({
    id: "66666666-6666-4666-8666-666666666666",
    action: "reminderDrafts",
    state: "completed",
    counts: { succeeded: 1, skipped: 0, conflict: 0, failed: 0 },
    items: [
      {
        itemId: "77777777-7777-4777-8777-777777777777",
        resourceId: caseId,
        state: "succeeded",
        reasonCode: null,
        reviewId: "88888888-8888-4888-8888-888888888888",
      },
    ],
  });
  reminderFns.getBulkReminderReview.mockResolvedValue({
    reviewId: "88888888-8888-4888-8888-888888888888",
    caseId,
    companyName: "Acme Company Limited",
    reviewState: "draft",
    previewHash: "c".repeat(64),
    recipientName: "Chris Client",
    recipientE164: "+85291234567",
    renderedText: "Approved exact reminder template",
    sendMode: "template",
    languageCode: "en",
    expiresAt: "2099-01-01T00:00:00.000Z",
    delivery: null,
  });
  reminderFns.approveBulkReminderReview.mockResolvedValue({
    state: "queued",
    messageId: "99999999-9999-4999-8999-999999999999",
    replayed: false,
  });
});
afterEach(cleanup);

describe("ProductionWhatsAppAutomation", () => {
  it("creates only review drafts until one recipient is explicitly approved", async () => {
    renderAutomation();
    await screen.findByText("Bulk annual return reminder drafts");
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Preview 1 drafts" }));
    expect(await screen.findByText("Approved exact reminder template")).toBeTruthy();
    expect(reminderFns.approveBulkReminderReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create review drafts" }));
    const approve = await screen.findByRole("button", { name: "Approve and queue this message" });
    expect(reminderFns.approveBulkReminderReview).not.toHaveBeenCalled();
    fireEvent.click(approve);
    await waitFor(() =>
      expect(reminderFns.approveBulkReminderReview).toHaveBeenCalledWith({
        data: { reviewId: "88888888-8888-4888-8888-888888888888", previewHash: "c".repeat(64) },
      }),
    );
  });
  it("t27_scenario_1 renders only one follow-up page and advances by server cursor", async () => {
    serverFns.listProductionFollowUpDrafts.mockImplementation(({ data }) =>
      Promise.resolve(
        data.cursor
          ? { drafts: [drafts[1]], nextCursor: null }
          : { drafts: [drafts[0]], nextCursor: "next-case" },
      ),
    );
    renderAutomation();
    expect(await screen.findByText("Annual return follow-up")).toBeTruthy();
    expect(screen.queryByText("Photo page is cropped.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Photo page is cropped.")).toBeTruthy();
    expect(screen.queryByText("Annual return follow-up")).toBeNull();
    expect(serverFns.listProductionFollowUpDrafts).toHaveBeenCalledWith({
      data: { cursor: "next-case", limit: 50 },
    });
    expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
  });

  it("keeps demo read-only even after reviewing an actual send", async () => {
    whatsAppServerFns.getWhatsAppIntegrationStatus.mockResolvedValue(simulated);
    renderAutomation();
    expect(await screen.findByText("Demo simulation")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Select available/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const buttons = await screen.findAllByRole("button", { name: "Review actual send" });
    fireEvent.click(buttons[0]);
    expect(await screen.findByText("Actual send preview")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Approve and queue" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
  });

  it("requires explicit approval for each source and sends its reviewed identity and hash", async () => {
    const invalidation = renderAutomation();
    const buttons = await screen.findAllByRole("button", { name: "Review actual send" });
    expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
    for (const [index, button] of buttons.entries()) {
      fireEvent.click(button);
      await waitFor(() =>
        expect(serverFns.previewProductionFollowUp).toHaveBeenCalledTimes(index + 1),
      );
      const approve = await screen.findByRole("button", { name: "Approve and queue" });
      fireEvent.click(approve);
      await waitFor(() =>
        expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(index + 1),
      );
    }
    expect(serverFns.sendProductionFollowUp.mock.calls.map(([call]) => call)).toEqual(
      drafts.map((draft) => ({
        data: {
          source: draft.source,
          caseId: draft.caseId,
          entityId: draft.entityId,
          previewHash: "a".repeat(64),
        },
      })),
    );
    await waitFor(() => expect(invalidation).toHaveBeenCalledTimes(6));
  });

  it("surfaces a preview failure without calling the queue service", async () => {
    serverFns.previewProductionFollowUp.mockRejectedValue(
      new Error("Verified contact or session is unavailable."),
    );
    renderAutomation();
    const buttons = await screen.findAllByRole("button", { name: "Review actual send" });
    fireEvent.click(buttons[1]);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Verified contact or session is unavailable.",
    );
    expect(serverFns.sendProductionFollowUp).not.toHaveBeenCalled();
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
  });
});
