// @vitest-environment jsdom
// R17: supplied F15 / UC109 regression, extended with local payment read contracts.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const f = vi.hoisted(() => ({
  cases: vi.fn(),
  getCase: vi.fn(),
  documents: vi.fn(),
  download: vi.fn(),
  record: vi.fn(),
  review: vi.fn(),
}));
vi.mock("@/features/annual-return/server-fns", () => ({
  listAnnualReturnCasePage: f.cases,
  getAnnualReturnCase: f.getCase,
  recordAnnualReturnPaymentEvidence: f.record,
  reviewAnnualReturnPaymentEvidence: f.review,
}));
vi.mock("@/features/documents/server-fns", () => ({
  listDocumentPage: f.documents,
  downloadDocument: f.download,
}));
vi.mock("@/components/bulk-selection-toolbar", () => ({ BulkSelectionToolbar: () => null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: ReactNode; params: { id: string } }) => (
    <a href={`/annual-returns/${params.id}`}>{children}</a>
  ),
}));
import { ProductionPaymentReview } from "./production-payment-review";
const caseId = "40000000-0000-4000-8000-000000000201";
const selectedCase = {
  id: caseId,
  companyName: "QA Case 201",
  currentStatus: "Payment pending",
  readiness: { sourceVersion: "a".repeat(32) },
  payment: {
    id: "payment-201",
    amount: 1800,
    receivedAmount: 600,
    balance: 1200,
    status: "Payment pending",
    paidAt: null,
    evidenceEntries: [],
  },
};
const doc = {
  id: "50000000-0000-4000-8000-000000000201",
  caseId,
  fileName: "qa-proof-201.pdf",
  category: "payment",
  currentVersionId: "60000000-0000-4000-8000-000000000201",
  uploadStatus: "available",
  scanVerdictSource: "provider",
  reviewStatus: "pending",
};
function view(
  actorScope = "qa-team-a",
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
) {
  return render(
    <QueryClientProvider client={client}>
      <ProductionPaymentReview actorScope={actorScope} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  f.cases.mockResolvedValue({ cases: [], nextCursor: null });
  f.documents.mockResolvedValue({ documents: [doc], nextCursor: null });
  f.getCase.mockImplementation(async ({ data }: { data: { id: string } }) =>
    data.id === caseId ? selectedCase : null,
  );
});
afterEach(cleanup);
it("UC108 positive control: current-page case supplies the review context", async () => {
  f.cases.mockResolvedValue({ cases: [selectedCase], nextCursor: null });
  view();
  const proofRow = (await screen.findByRole("button", { name: "儲存憑證資料" })).closest(
    "article",
  )!;
  expect(within(proofRow).getByText(/餘額：HK\$1,200.00/)).toBeTruthy();
  expect(screen.queryByText(/先載入所屬案件資料/)).toBeNull();
});
it("F15 / UC109: a page1 proof for case201 is actionable without paging unrelated cases", async () => {
  f.cases.mockResolvedValue({
    cases: Array.from({ length: 200 }, (_, i) => ({
      ...selectedCase,
      id: `case-${i}`,
      companyName: `QA Other ${i}`,
    })),
    nextCursor: "qa-page-2",
  });
  view();
  expect(await screen.findByRole("button", { name: "儲存憑證資料" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "QA Case 201" }).getAttribute("href")).toBe(
    `/annual-returns/${caseId}`,
  );
  expect(screen.queryByText(/先載入所屬案件資料；暫不可審核/)).toBeNull();
  expect(f.cases).toHaveBeenCalledTimes(1);
  expect(f.getCase).toHaveBeenCalledWith({ data: { id: caseId } });
});
it("proof101 remains reachable without loading case pages", async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({
    ...doc,
    id: `proof-${i + 1}`,
    fileName: `proof-${i + 1}.pdf`,
  }));
  f.documents.mockImplementation(async ({ data }: { data: { cursor?: string } }) =>
    data.cursor
      ? { documents: [{ ...doc, fileName: "proof-101.pdf" }], nextCursor: null }
      : { documents: first, nextCursor: "proof-page-2" },
  );
  view();
  fireEvent.click(await screen.findByRole("button", { name: "載入更多付款憑證" }));
  const proof = await screen.findByText(/proof-101.pdf/);
  const proofRow = within(proof.closest("article")!);
  const record = proofRow.getByRole("button", { name: "儲存憑證資料" });
  fireEvent.change(proofRow.getByLabelText("憑證金額"), { target: { value: "600" } });
  fireEvent.change(proofRow.getByLabelText("憑證收款日期"), {
    target: { value: "2026-10-23" },
  });
  await waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("button", { name: "載入更多付款憑證" })).toBeNull();
  expect(f.cases).toHaveBeenCalledTimes(1);
});
it("offers debt case links without any proof and shows trusted partial balances", async () => {
  f.documents.mockResolvedValue({ documents: [], nextCursor: null });
  f.cases.mockResolvedValue({
    cases: [
      {
        ...selectedCase,
        companyName: "No proof unpaid",
        payment: { ...selectedCase.payment, receivedAmount: 0, balance: 1800 },
      },
      {
        ...selectedCase,
        id: "partial",
        companyName: "Trusted partial",
        payment: { ...selectedCase.payment, balance: 1199.99 },
      },
      {
        ...selectedCase,
        id: "late",
        companyName: "No proof overdue",
        payment: { ...selectedCase.payment, receivedAmount: 0, balance: 1800, status: "Overdue" },
      },
      {
        ...selectedCase,
        id: "paid",
        companyName: "Fully paid",
        payment: {
          ...selectedCase.payment,
          receivedAmount: 1800,
          balance: 0,
          status: "Payment received",
        },
      },
    ],
    nextCursor: null,
  });
  view();
  expect((await screen.findByRole("link", { name: "No proof unpaid" })).getAttribute("href")).toBe(
    `/annual-returns/${caseId}`,
  );
  expect(screen.getByRole("link", { name: "No proof overdue" })).toBeTruthy();
  expect(screen.getByText(/餘額：HK\$1,199.99/)).toBeTruthy();
  for (const label of ["部分收款", "未收款", "逾期"]) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Fully paid" })).toBeNull();
});
it.each([null, new Error("denied"), { ...selectedCase, id: "wrong-case" }])(
  "fails closed on absent, denied or mismatched targeted case: %s",
  async (result) => {
    if (result instanceof Error) f.getCase.mockRejectedValue(result);
    else f.getCase.mockResolvedValue(result);
    view();
    await screen.findByText(/案件資料不可用或沒有權限/);
    expect(screen.queryByRole("button", { name: "儲存憑證資料" })).toBeNull();
    expect(screen.queryByText("QA Case 201")).toBeNull();
    expect(f.download).not.toHaveBeenCalled();
  },
);
it("reviews a proof even when the unrelated case list fails", async () => {
  f.cases.mockRejectedValue(new Error("unavailable"));
  view();
  expect(await screen.findByRole("button", { name: "儲存憑證資料" })).toBeTruthy();
  expect(screen.queryByText("沒有待覆核的付款憑證。")).toBeNull();
});
it("keeps previous proofs and shows a retry error when proof pagination fails", async () => {
  f.documents
    .mockResolvedValueOnce({ documents: [doc], nextCursor: "next" })
    .mockRejectedValue(new Error("unavailable"));
  view();
  await screen.findByRole("button", { name: "儲存憑證資料" });
  fireEvent.click(screen.getByRole("button", { name: "載入更多付款憑證" }));
  await screen.findByText("下一頁付款憑證未能載入，請重試。");
  expect(screen.getByText(/qa-proof-201.pdf/)).toBeTruthy();
  expect(screen.queryByText("沒有待覆核的付款憑證。")).toBeNull();
});
it("loads the next debt page without requiring proofs", async () => {
  f.documents.mockResolvedValue({ documents: [], nextCursor: null });
  f.cases
    .mockResolvedValueOnce({ cases: [], nextCursor: "debt-page-2" })
    .mockResolvedValueOnce({ cases: [selectedCase], nextCursor: null });
  view();
  fireEvent.click(await screen.findByRole("button", { name: "載入更多案件" }));
  expect(await screen.findByRole("link", { name: "QA Case 201" })).toBeTruthy();
});
it("hides cached debt details when the refreshed case list is denied", async () => {
  f.documents.mockResolvedValue({ documents: [], nextCursor: null });
  f.cases.mockResolvedValue({ cases: [selectedCase], nextCursor: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  view("qa-team-a", client);
  await screen.findByRole("link", { name: "QA Case 201" });
  f.cases.mockRejectedValue(new Error("denied"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["annual-returns", "list"] });
  });
  await screen.findByRole("alert");
  expect(screen.queryByRole("link", { name: "QA Case 201" })).toBeNull();
  expect(screen.queryByText(/餘額：HK\$1,200.00/)).toBeNull();
  client.clear();
});
it.each([
  { uploadStatus: "rejected" },
  { scanVerdictSource: "deterministic" },
  { currentVersionId: null },
  { availability: "missing_object" },
])("disables unsafe or unavailable proof: %s", async (safety) => {
  f.documents.mockResolvedValue({ documents: [{ ...doc, ...safety }], nextCursor: null });
  view();
  expect(
    ((await screen.findByRole("button", { name: "儲存憑證資料" })) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((screen.getByRole("button", { name: "退回補傳" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(f.download).not.toHaveBeenCalled();
});
it("does not reuse another actor's cached case on denial", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = view("qa-team-a", client);
  await screen.findByRole("button", { name: "儲存憑證資料" });
  first.unmount();
  f.getCase.mockResolvedValue(null);
  view("qa-team-b", client);
  await screen.findByText(/案件資料不可用或沒有權限/);
  expect(screen.queryByText("QA Case 201")).toBeNull();
  client.clear();
});
it("disables stale review controls during refresh then hides denied context", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  view("qa-team-a", client);
  await screen.findByRole("button", { name: "儲存憑證資料" });
  fireEvent.change(screen.getByLabelText("憑證金額"), { target: { value: "600" } });
  fireEvent.change(screen.getByLabelText("憑證收款日期"), { target: { value: "2026-10-23" } });
  let deny!: (value: null) => void;
  f.getCase.mockImplementation(
    () =>
      new Promise<null>((resolve) => {
        deny = resolve;
      }),
  );
  act(() => {
    void client.invalidateQueries({ queryKey: ["annual-returns", "detail", caseId] });
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "儲存憑證資料" }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  await act(async () => {
    deny(null);
  });
  await screen.findByText(/案件資料不可用或沒有權限/);
  expect(screen.queryByLabelText("憑證金額")).toBeNull();
  client.clear();
});
it.each(["record", "verified", "rejected"] as const)(
  "allows only one simultaneous %s submission with exact source version",
  async (command) => {
    if (command === "verified")
      f.getCase.mockResolvedValue({
        ...selectedCase,
        payment: {
          ...selectedCase.payment,
          evidenceEntries: [
            {
              id: "entry",
              documentId: doc.id,
              proofVersionId: doc.currentVersionId,
              amount: 600,
              receivedOn: "2026-10-23",
              status: "pending",
            },
          ],
        },
      });
    const mutation = command === "record" ? f.record : f.review;
    mutation.mockImplementation(() => new Promise(() => {}));
    view();
    const name =
      command === "record"
        ? "儲存憑證資料"
        : command === "verified"
          ? "批准此筆憑證金額"
          : "退回補傳";
    const button = await screen.findByRole("button", { name });
    if (command === "record") {
      fireEvent.change(screen.getByLabelText("憑證金額"), { target: { value: "600" } });
      fireEvent.change(screen.getByLabelText("憑證收款日期"), { target: { value: "2026-10-23" } });
    } else if (command === "rejected")
      fireEvent.change(screen.getByLabelText("具體退回原因"), {
        target: { value: "Unreadable reference" },
      });
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
    expect(mutation).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId,
        paymentId: "payment-201",
        documentId: doc.id,
        proofVersionId: doc.currentVersionId,
        expectedVersion: "a".repeat(32),
        ...(command === "record"
          ? { amount: "600", receivedOn: "2026-10-23" }
          : { decision: command }),
      }),
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    if (command === "rejected") expect(f.record).not.toHaveBeenCalled();
  },
);
