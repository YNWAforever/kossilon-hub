// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  actor: {
    authUserId: "QA-UC149-Client-A",
    role: "Client",
    userId: null,
    teamId: null,
    active: true,
  },
  cases: vi.fn(),
  documents: vi.fn(),
  intent: vi.fn(),
  finalize: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ dataMode: "production", actor: f.actor }),
    useSearch: () => ({ caseId: "4e52ac19-0149-4149-8149-000000000004" }),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/portal">{children}</a>,
}));
vi.mock("../features/annual-return/client-portal-server-fns", () => ({
  getClientPortalCase: f.cases,
  listClientPortalCases: async () => [],
}));
vi.mock("../features/annual-return/server-fns", () => ({
  getAnnualReturnCase: vi.fn(),
  listAnnualReturnCasePage: vi.fn(),
}));
vi.mock("../features/documents/server-fns", () => ({
  listDocumentPage: f.documents,
  createDocumentUploadIntent: f.intent,
  finalizeDocumentUpload: f.finalize,
  downloadDocument: vi.fn(),
}));
import { Route } from "./portal";
const companyId = "4e52ac19-0149-4149-8149-000000000003",
  caseId = "4e52ac19-0149-4149-8149-000000000004";
const itemId = "4e52ac19-0149-4149-8149-000000000007";
const reason = "missing-signature: 缺少必要簽署 — 第 2 頁未有董事簽署，請補正後重新上載。";
const original = {
  id: "4e52ac19-0149-4149-8149-000000000002",
  fileName: "QA-rejected.pdf",
  uploadStatus: "available",
  reviewStatus: "rejected",
  rejectionReason: reason,
};
let saved: object[], received: boolean;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  received = false;
  saved = [original];
  f.actor = { ...f.actor, authUserId: "QA-UC149-Client-A" };
  f.cases.mockImplementation(async () => ({
    id: caseId,
    companyId,
    companyName: "QA UC149 Company",
    returnYear: 2026,
    filingDueDate: "2026-12-01",
    currentStatus: "Documents pending",
    checklist: [
      {
        id: itemId,
        itemLabel: "NAR1 form",
        required: true,
        status: received ? "Received" : "Rejected",
        dueDate: "2026-12-01",
      },
    ],
  }));
  f.documents.mockImplementation(async () => ({
    documents: structuredClone(saved),
    nextCursor: null,
  }));
  f.intent.mockResolvedValue({ id: "4e52ac19-0149-4149-8149-000000000008" });
  f.finalize.mockImplementation(async () => {
    received = true;
    saved.push({
      id: "4e52ac19-0149-4149-8149-000000000009",
      fileName: "QA-corrected.pdf",
      uploadStatus: "quarantined",
      reviewStatus: "pending",
      rejectionReason: null,
    });
    return {};
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});
async function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const Page = Route.options.component!;
  await Page.preload?.();
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>Local loading</p>}>
        <Page />
      </Suspense>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", {
    name: f.actor.authUserId === "QA-UC149-Client-B" ? "找不到周年申報" : "QA UC149 Company",
  });
  return client;
}
async function chooseFile() {
  const file = new File(["%PDF-1.4 QA only"], "QA-corrected.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode("%PDF-1.4 QA only").buffer,
  });
  fireEvent.change(screen.getByLabelText("回應哪一項要求"), { target: { value: itemId } });
  fireEvent.change(screen.getByLabelText("要上載的文件"), { target: { files: [file] } });
}
it("shows the actionable returned reason to the client, including after fresh-cache reopen", async () => {
  await view();
  await screen.findByText(reason, { exact: false });
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  await view();
  await screen.findByText(reason, { exact: false });
});
it("does not reuse an old reason for a pending replacement", async () => {
  saved = [{ ...original, reviewStatus: "pending", rejectionReason: "Old private instruction" }];
  await view();
  await screen.findByText("QA-rejected.pdf");
  expect(screen.queryByText(/Old private instruction/)).toBeNull();
});
it("makes missing historical rejection guidance explicit", async () => {
  saved = [{ ...original, rejectionReason: null }];
  await view();
  await screen.findByText(/退回原因未有記錄/);
});
it("refreshes documents and requirement state after explicit upload retry, without claiming review success", async () => {
  f.finalize.mockRejectedValueOnce(new Error("Local temporary upload failure"));
  await view();
  await chooseFile();
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  fireEvent.click(await screen.findByRole("button", { name: "重試" }));
  await waitFor(() => expect(f.finalize).toHaveBeenCalledTimes(2));
  await screen.findByText(/我們已收到您提供的 1 份文件，現正覆核/);
  expect(screen.getAllByText("QA-corrected.pdf").length).toBe(2);
  expect(saved[0]).toMatchObject({ reviewStatus: "rejected", rejectionReason: reason });
  expect(saved[1]).toMatchObject({ reviewStatus: "pending", rejectionReason: null });
  expect(f.intent).toHaveBeenCalledWith({
    data: expect.objectContaining({
      companyId,
      caseId,
      checklistItemId: itemId,
      fileName: "QA-corrected.pdf",
    }),
  });
});
it("does not expose another client's cached reason after role scope changes", async () => {
  const client = await view();
  await screen.findByText("QA-rejected.pdf");
  f.actor.authUserId = "QA-UC149-Client-B";
  f.cases.mockRejectedValue(new Error("Forbidden"));
  await act(async () => {
    await client.invalidateQueries();
  });
  cleanup();
  await view();
  await screen.findByText("找不到周年申報");
  expect(screen.queryByText(reason, { exact: false })).toBeNull();
});

it("starts one upload for repeated submissions while the same file is pending", async () => {
  let release!: (value: { id: string }) => void;
  const intent = new Promise<{ id: string }>((resolve) => {
    release = resolve;
  });
  f.intent.mockReturnValue(intent);
  await view();
  await chooseFile();
  const button = screen.getByRole("button", { name: "安全上載" });
  act(() => {
    button.click();
    button.click();
  });
  try {
    await waitFor(() => expect(f.intent).toHaveBeenCalledTimes(1));
    expect((button as HTMLButtonElement).disabled).toBe(true);
  } finally {
    await act(async () => {
      release({ id: "4e52ac19-0149-4149-8149-000000000008" });
    });
  }
  await waitFor(() => expect(f.finalize).toHaveBeenCalledTimes(1));
});
