// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  actor: { authUserId: "QA-UC150-A", role: "Client", userId: null, teamId: null, active: true },
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
    useSearch: () => ({ caseId: "98d2f4c9-0150-4150-8150-000000000004" }),
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
const companyId = "98d2f4c9-0150-4150-8150-000000000003",
  caseId = "98d2f4c9-0150-4150-8150-000000000004",
  itemId = "98d2f4c9-0150-4150-8150-000000000007";
type Attempt = {
  id: string;
  uploadRequestId?: string;
  status: string;
  expiresAt: string;
  documentId: string | null;
  [key: string]: unknown;
};
let attempts: Attempt[], saved: object[], lostCreate: boolean, lostFinalize: boolean;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  f.actor = { ...f.actor, authUserId: "QA-UC150-A" };
  attempts = [];
  saved = [];
  lostCreate = false;
  lostFinalize = false;
  f.cases.mockImplementation(async () => ({
    id: caseId,
    companyId,
    companyName: "QA UC150 Company",
    returnYear: 2026,
    filingDueDate: "2026-12-01",
    currentStatus: "Documents pending",
    checklist: [
      {
        id: itemId,
        itemLabel: "NAR1 form",
        required: true,
        status: saved.length ? "Received" : "Missing",
      },
    ],
  }));
  f.documents.mockImplementation(async () => ({
    documents: f.actor.authUserId === "QA-UC150-A" ? structuredClone(saved) : [],
    nextCursor: null,
  }));
  // This stub models a server with idempotency; tests exercise the production
  // UI sending/recovering that identity, not an alternate UI implementation.
  f.intent.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    let row = data.uploadRequestId
      ? attempts.find((a) => a.uploadRequestId === data.uploadRequestId)
      : undefined;
    if (!row) {
      row = {
        ...data,
        id: `98d2f4c9-0150-4150-8150-${String(100 + attempts.length).padStart(12, "0")}`,
        uploadRequestId: data.uploadRequestId as string | undefined,
        status: "created",
        documentId: null,
        expiresAt: "2099-01-01T00:00:00Z",
      };
      attempts.push(row);
    }
    if (lostCreate) {
      lostCreate = false;
      throw Error("Response lost after intent commit");
    }
    return structuredClone(row);
  });
  f.finalize.mockImplementation(async ({ data }: { data: { intentId: string } }) => {
    const row = attempts.find((a) => a.id === data.intentId)!;
    if (!row.documentId) {
      row.documentId = `98d2f4c9-0150-4150-8150-${String(200 + saved.length).padStart(12, "0")}`;
      row.status = "quarantined";
      saved.push({
        id: row.documentId,
        fileName: row.fileName,
        uploadStatus: "quarantined",
        reviewStatus: "pending",
        rejectionReason: null,
      });
    }
    if (lostFinalize) {
      lostFinalize = false;
      throw Error("Response lost after document commit");
    }
    return saved.find((doc) => (doc as { id: string }).id === row.documentId);
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
  sessionStorage.clear();
});
async function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const Page = Route.options.component!;
  await Page.preload?.();
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>Loading</p>}>
        <Page />
      </Suspense>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "QA UC150 Company" });
}
async function choose(size = 36, modified = 150, changed = false, fileName = "QA-resume.pdf") {
  const bytes = new Uint8Array(size).fill(changed ? 42 : 32);
  bytes.set(new TextEncoder().encode("%PDF-1.4 UC150 local-only\n"));
  const file = new File([bytes], fileName, {
    type: "application/pdf",
    lastModified: modified,
  });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  const requirement = screen.queryByLabelText("回應哪一項要求");
  if (requirement) fireEvent.change(requirement, { target: { value: itemId } });
  fireEvent.change(screen.getByLabelText("要上載的文件"), { target: { files: [file] } });
}
async function submitAndLose() {
  lostFinalize = true;
  await view();
  await choose();
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await screen.findByRole("button", { name: "重試" });
  expect(saved).toHaveLength(1);
}
it("reuses one logical upload after a near-limit PDF commits but its response is lost", async () => {
  lostFinalize = true;
  await view();
  await choose(10 * 1024 * 1024 - 1024);
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  fireEvent.click(await screen.findByRole("button", { name: "重試" }));
  await screen.findByText(/我們已收到您提供的 1 份文件，現正覆核/);
  expect(attempts).toHaveLength(1);
  expect(saved).toHaveLength(1);
  expect(f.intent.mock.calls[0][0].data.uploadRequestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(f.finalize.mock.calls.map((c) => c[0].data.intentId)).toEqual([
    attempts[0].id,
    attempts[0].id,
  ]);
}, 20_000);
it("reuses the request identity when even the intent response was lost", async () => {
  lostCreate = true;
  await view();
  await choose();
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  fireEvent.click(await screen.findByRole("button", { name: "重試" }));
  await screen.findByText(/已收到，等待掃描/);
  expect(attempts).toHaveLength(1);
  expect(saved).toHaveLength(1);
});
it("restores uncertain scope after fresh-cache reopen and file re-selection even after the requirement became Received", async () => {
  await submitAndLose();
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  await view();
  fireEvent.click(await screen.findByRole("button", { name: "繼續此上載" }));
  await choose(36, 151);
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await screen.findByText(/已收到，等待掃描/);
  expect(attempts).toHaveLength(1);
  expect(saved).toHaveLength(1);
  expect(f.intent.mock.calls.at(-1)![0].data.checklistItemId).toBe(itemId);
});
it("refuses different bytes selected for an uncertain attempt before any further RPC", async () => {
  await submitAndLose();
  cleanup();
  await view();
  fireEvent.click(await screen.findByRole("button", { name: "繼續此上載" }));
  await choose(36, 151, true);
  const count = f.intent.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await screen.findByText(/檔案與先前的上載不符/);
  expect(f.intent).toHaveBeenCalledTimes(count);
  expect(saved).toHaveLength(1);
});
it("does not start an unjournaled request if session persistence fails", async () => {
  await view();
  await choose();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("Quota");
  });
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await screen.findByText(/無法保存上載恢復紀錄/);
  expect(f.intent).not.toHaveBeenCalled();
  expect(f.finalize).not.toHaveBeenCalled();
});
it("leaves an intent response arriving after departure resumable, without starting finalize", async () => {
  let release!: (value: Attempt) => void;
  const pending = new Promise<Attempt>((resolve) => {
    release = resolve;
  });
  f.intent.mockReturnValueOnce(pending);
  await view();
  await choose();
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await waitFor(() => expect(f.intent).toHaveBeenCalledTimes(1));
  cleanup();
  await act(async () => {
    release({
      id: "98d2f4c9-0150-4150-8150-000000000900",
      status: "created",
      documentId: null,
      expiresAt: "2099-01-01T00:00:00Z",
    });
  });
  expect(f.finalize).not.toHaveBeenCalled();
});
it("does not show another actor's unfinished journal", async () => {
  await submitAndLose();
  cleanup();
  f.actor = { ...f.actor, authUserId: "QA-UC150-B" };
  await view();
  expect(screen.queryByRole("button", { name: "繼續此上載" })).toBeNull();
});
it.each(["created", "expired"])(
  "only starts a new request after a server-confirmed %s uncommitted attempt",
  async (status) => {
    const create = f.intent.getMockImplementation()!;
    f.intent.mockImplementationOnce(async (args) => {
      const result = await create(args);
      attempts[0].expiresAt = "2000-01-01T00:00:00Z";
      return { ...result, status, expiresAt: attempts[0].expiresAt };
    });
    await view();
    await choose();
    fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
    await screen.findByText(/上載要求已過期且未提交/);
    expect(f.finalize).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(1);
    expect(saved).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    await screen.findByText(/已收到，等待掃描/);
    expect(attempts).toHaveLength(2);
    expect(saved).toHaveLength(1);
    expect(attempts[0].documentId).toBeNull();
    expect(attempts[0].uploadRequestId).not.toBe(attempts[1].uploadRequestId);
  },
);
it("honors explicit resume B over cached file A, rejecting A then confirming only B", async () => {
  lostFinalize = true;
  await view();
  await choose(36, 150, false, "QA-A.pdf");
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await screen.findByRole("button", { name: "重試" });
  lostFinalize = true;
  await choose(36, 151, true, "QA-B.pdf");
  const categorySelect = screen
    .getAllByRole("combobox")
    .find((select) => select.querySelector('option[value="signature"]'))!;
  fireEvent.change(categorySelect, { target: { value: "signature" } });
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await screen.findByRole("button", { name: "重試" });
  expect(attempts).toHaveLength(2);
  expect(saved).toHaveLength(2);
  const pending = screen.getByLabelText("未完成上載");
  const rowB = within(pending).getByText("QA-B.pdf").closest("div")!;
  fireEvent.click(within(rowB).getByRole("button", { name: "繼續此上載" }));
  await choose(36, 150, false, "QA-A.pdf");
  const count = f.intent.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await screen.findByText(/檔案與先前的上載不符/);
  expect(f.intent).toHaveBeenCalledTimes(count);
  await choose(36, 151, true, "QA-B.pdf");
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await screen.findByText(/已收到，等待掃描/);
  expect(f.intent.mock.calls.at(-1)![0].data.uploadRequestId).toBe(attempts[1].uploadRequestId);
  expect(f.intent.mock.calls.at(-1)![0].data.category).toBe("signature");
  expect(attempts).toHaveLength(2);
  expect(saved).toHaveLength(2);
});
it("fails closed on a corrupt journal instead of replacing an uncertain identity", async () => {
  const scope = { actorScope: JSON.stringify(f.actor), companyId, caseId };
  sessionStorage.setItem(`kossilon:upload-resume:v1:${JSON.stringify(scope)}`, "{");
  await view();
  await choose();
  fireEvent.click(screen.getByRole("button", { name: "安全上載" }));
  await screen.findByText(/無法讀取上載恢復紀錄/);
  expect(f.intent).not.toHaveBeenCalled();
  expect(f.finalize).not.toHaveBeenCalled();
});
it("cancels resume selection without erasing the uncertain request or issuing writes", async () => {
  await submitAndLose();
  cleanup();
  await view();
  fireEvent.click(await screen.findByRole("button", { name: "繼續此上載" }));
  const calls = f.intent.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "取消恢復選擇" }));
  expect(screen.getByRole("button", { name: "繼續此上載" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "安全上載" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(f.intent).toHaveBeenCalledTimes(calls);
  expect(saved).toHaveLength(1);
});
