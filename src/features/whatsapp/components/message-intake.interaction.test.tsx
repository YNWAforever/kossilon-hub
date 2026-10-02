// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageIntake } from "./message-intake";
const api = vi.hoisted(() => ({
  previewWhatsAppMessage: vi.fn(),
  mapWhatsAppMessage: vi.fn(),
  intakeWhatsAppMedia: vi.fn(),
}));
const annual = vi.hoisted(() => ({
  listAnnualReturnCasePage: vi.fn(),
  getAnnualReturnCase: vi.fn(async () => ({ checklist: [] })),
}));
vi.mock("../intake-server-fns", () => api);
vi.mock("@/features/annual-return/server-fns", () => annual);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("inbound mapping and quarantine approval", () => {
  it("loads a bounded case preview and submits only the observed mapping with reason", async () => {
    api.previewWhatsAppMessage.mockResolvedValue({
      messageId: "owned-message",
      companyId: null,
      caseId: null,
      version: 4,
      media: [],
    });
    annual.listAnnualReturnCasePage.mockResolvedValue({
      cases: [
        {
          id: "owned-case",
          companyName: "Owned Company",
          returnYear: 2026,
          dataOrigin: "client",
          currentStatus: "Draft",
          lockedAt: null,
          checklist: [],
        },
      ],
      nextCursor: null,
    });
    api.mapWhatsAppMessage.mockResolvedValue({ applied: true, version: 5 });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MessageIntake messageId="owned-message" canManageMapping />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review message mapping and attachments" }));
    fireEvent.change(await screen.findByLabelText("Target client case"), {
      target: { value: "owned-case" },
    });
    fireEvent.change(screen.getByLabelText("Mapping confirmation reason"), {
      target: { value: "Confirmed client evidence" },
    });
    expect(api.mapWhatsAppMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve case mapping" }));
    await vi.waitFor(() =>
      expect(api.mapWhatsAppMessage).toHaveBeenCalledWith({
        data: {
          messageId: "owned-message",
          caseId: "owned-case",
          expectedVersion: 4,
          reason: "Confirmed client evidence",
        },
      }),
    );
    expect(annual.listAnnualReturnCasePage).toHaveBeenCalledWith({
      data: { activeOnly: true, limit: 25, includeFixtures: false },
    });
  });
  it("reports a download block without claiming receipt or clean scan", async () => {
    api.previewWhatsAppMessage.mockResolvedValue({
      messageId: "owned-message",
      companyId: "owned-company",
      caseId: "owned-case",
      version: 2,
      media: [{ id: "owned-media", kind: "file", mediaType: "IMAGE", documentId: null }],
    });
    annual.listAnnualReturnCasePage.mockResolvedValue({ cases: [], nextCursor: null });
    api.intakeWhatsAppMedia.mockResolvedValue({
      status: "blocked",
      errorCode: "media-host-policy-missing",
      retryable: false,
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MessageIntake messageId="owned-message" canManageMapping={false} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review message mapping and attachments" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Receive attachment into quarantine" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("media-host-policy-missing"),
    );
    expect(screen.queryByText(/Attachment received/)).toBeNull();
    expect(api.intakeWhatsAppMedia).toHaveBeenCalledWith({
      data: { mediaId: "owned-media", expectedMappingVersion: 2, category: "other" },
    });
    expect(screen.queryByRole("button", { name: "Approve case mapping" })).toBeNull();
  });
});
