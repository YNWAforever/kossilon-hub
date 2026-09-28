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
  serverFns.listProductionFollowUpDrafts.mockResolvedValue(drafts);
  serverFns.previewProductionFollowUp.mockImplementation(({ data }) => {
    const draft = drafts.find(
      (item) => item.source === data.source && item.entityId === data.entityId,
    );
    return Promise.resolve(previewFor(draft!));
  });
  serverFns.sendProductionFollowUp.mockResolvedValue({ replayed: false });
  whatsAppServerFns.getWhatsAppIntegrationStatus.mockResolvedValue(healthy);
});
afterEach(cleanup);

describe("ProductionWhatsAppAutomation", () => {
  it("keeps demo read-only even after reviewing an actual send", async () => {
    whatsAppServerFns.getWhatsAppIntegrationStatus.mockResolvedValue(simulated);
    renderAutomation();
    expect(await screen.findByText("Demo simulation")).toBeTruthy();
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
