// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionFollowUpDraft } from "../follow-ups";
import { ProductionWhatsAppAutomation } from "./production-whatsapp-automation";

const serverFns = vi.hoisted(() => ({
  listProductionFollowUpDrafts: vi.fn(),
  sendProductionFollowUp: vi.fn(),
}));

vi.mock("../follow-up-server-fns", () => serverFns);

const caseId = "11111111-1111-4111-8111-111111111111";
const drafts: ProductionFollowUpDraft[] = [
  {
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

beforeEach(() => {
  vi.clearAllMocks();
  serverFns.listProductionFollowUpDrafts.mockResolvedValue(drafts);
  serverFns.sendProductionFollowUp.mockResolvedValue({ replayed: false });
});

afterEach(cleanup);

describe("ProductionWhatsAppAutomation", () => {
  it("renders persisted rows and invokes the durable action for all three sources", async () => {
    const invalidateSpy = renderAutomation();
    const buttons = await screen.findAllByRole("button", { name: "Send now" });
    expect(buttons).toHaveLength(3);

    for (const button of buttons) {
      fireEvent.click(button);
      await waitFor(() =>
        expect(serverFns.sendProductionFollowUp).toHaveBeenCalledTimes(buttons.indexOf(button) + 1),
      );
    }

    expect(serverFns.sendProductionFollowUp.mock.calls.map(([call]) => call)).toEqual(
      drafts.map((draft) => ({
        data: { source: draft.source, caseId: draft.caseId, entityId: draft.entityId },
      })),
    );
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("disables only the active row and surfaces mutation errors", async () => {
    let rejectSend!: (error: Error) => void;
    serverFns.sendProductionFollowUp.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    renderAutomation();
    const buttons = await screen.findAllByRole("button", { name: "Send now" });
    fireEvent.click(buttons[1]);

    await waitFor(() => expect((buttons[1] as HTMLButtonElement).disabled).toBe(true));
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[2] as HTMLButtonElement).disabled).toBe(false);

    rejectSend(new Error("Unable to queue follow-up."));
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to queue follow-up.");
  });
});
