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

it("recovers a proof's case read and uses the freshly read source version for a safe action", async () => {
  let resolveCase!: (value: typeof selectedCase) => void;
  f.getCase.mockRejectedValueOnce(new Error("temporary case failure")).mockImplementationOnce(
    () =>
      new Promise<typeof selectedCase>((resolve) => {
        resolveCase = resolve;
      }),
  );
  f.record.mockImplementation(() => new Promise(() => {}));
  view();
  await screen.findByText(/案件資料不可用或沒有權限/);
  expect(screen.queryByLabelText("憑證金額")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: `重新載入 ${doc.fileName} 的案件資料` }));
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "儲存憑證資料" })).toBeNull();
  expect(f.record).not.toHaveBeenCalled();
  expect(f.review).not.toHaveBeenCalled();
  await act(async () => {
    resolveCase({ ...selectedCase, readiness: { sourceVersion: "b".repeat(32) } });
  });
  await screen.findByRole("button", { name: "儲存憑證資料" });
  fireEvent.change(screen.getByLabelText("憑證金額"), { target: { value: "600" } });
  fireEvent.change(screen.getByLabelText("憑證收款日期"), { target: { value: "2026-10-26" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存憑證資料" }));
  await waitFor(() =>
    expect(f.record).toHaveBeenCalledWith({
      data: {
        caseId,
        paymentId: "payment-201",
        documentId: doc.id,
        proofVersionId: doc.currentVersionId,
        expectedVersion: "b".repeat(32),
        amount: "600",
        receivedOn: "2026-10-26",
      },
    }),
  );
  expect(f.getCase).toHaveBeenCalledTimes(2);
  expect(f.getCase).toHaveBeenLastCalledWith({ data: { id: caseId } });
  expect(f.cases).toHaveBeenCalledTimes(1);
  expect(f.documents).toHaveBeenCalledTimes(1);
});

it.each([null, new Error("still denied"), { ...selectedCase, id: "wrong-case" }])(
  "keeps proof recovery closed when the new case result is unavailable: %s",
  async (result) => {
    f.getCase.mockRejectedValueOnce(new Error("temporary failure"));
    if (result instanceof Error) f.getCase.mockRejectedValueOnce(result);
    else f.getCase.mockResolvedValueOnce(result);
    view();
    await screen.findByText(/案件資料不可用或沒有權限/);
    fireEvent.click(screen.getByRole("button", { name: `重新載入 ${doc.fileName} 的案件資料` }));
    await waitFor(() => expect(f.getCase).toHaveBeenCalledTimes(2));
    await screen.findByText(/案件資料不可用或沒有權限/);
    expect(screen.queryByLabelText("憑證金額")).toBeNull();
    expect(screen.queryByRole("link", { name: selectedCase.companyName })).toBeNull();
    expect(f.record).not.toHaveBeenCalled();
    expect(f.review).not.toHaveBeenCalled();
    expect(f.download).not.toHaveBeenCalled();
  },
);

it("requires document-list recovery before offering a proof's case retry", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  view("qa-team-a", client);
  await screen.findByRole("button", { name: "儲存憑證資料" });
  f.documents.mockRejectedValue(new Error("document read denied"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["annual-returns", "payment"] });
  });
  await screen.findByText(/案件資料不可用或沒有權限/);
  expect(screen.queryByRole("button", { name: `重新載入 ${doc.fileName} 的案件資料` })).toBeNull();
  expect(screen.getByRole("button", { name: "重新載入付款資料" })).toBeTruthy();
  expect(screen.queryByLabelText("憑證金額")).toBeNull();
  client.clear();
});

it.each(["record", "verified", "rejected"] as const)(
  "requires read-only reconciliation after a failed %s command",
  async (command) => {
    const pendingEntry = {
      id: "entry",
      documentId: doc.id,
      proofVersionId: doc.currentVersionId,
      amount: 600,
      receivedOn: "2026-10-23",
      status: "pending",
    };
    if (command === "verified")
      f.getCase.mockResolvedValue({
        ...selectedCase,
        payment: { ...selectedCase.payment, evidenceEntries: [pendingEntry] },
      });
    const mutation = command === "record" ? f.record : f.review;
    mutation.mockRejectedValueOnce(new Error("Conflict or response lost"));
    view();
    const name =
      command === "record"
        ? "儲存憑證資料"
        : command === "verified"
          ? "批准此筆憑證金額"
          : "退回補傳";
    await screen.findByRole("button", { name });
    if (command === "record") {
      fireEvent.change(screen.getByLabelText("憑證金額"), { target: { value: "600" } });
      fireEvent.change(screen.getByLabelText("憑證收款日期"), { target: { value: "2026-10-26" } });
    } else if (command === "rejected")
      fireEvent.change(screen.getByLabelText("具體退回原因"), { target: { value: "Unreadable" } });
    fireEvent.click(screen.getByRole("button", { name }));
    const recover = await screen.findByRole("button", {
      name: `重新核對 ${doc.fileName} 的付款結果`,
    });
    expect(screen.queryByRole("button", { name })).toBeNull();
    expect(mutation).toHaveBeenCalledTimes(1);
    let finish!: (value: unknown) => void;
    f.getCase.mockResolvedValue({
      ...selectedCase,
      readiness: { sourceVersion: "b".repeat(32) },
      payment: {
        ...selectedCase.payment,
        receivedAmount: 1200,
        balance: 600,
        evidenceEntries:
          command === "record"
            ? [pendingEntry]
            : command === "verified"
              ? [{ ...pendingEntry, status: "verified" }]
              : [],
        proofReturns:
          command === "rejected"
            ? [
                {
                  documentId: doc.id,
                  proofVersionId: doc.currentVersionId,
                  reasonCode: "unreadable",
                  reasonText: "Unreadable",
                },
              ]
            : [],
      },
    });
    f.documents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(recover);
    await waitFor(() => expect(f.documents).toHaveBeenCalledTimes(2));
    expect((recover as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(recover);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name })).toBeNull();
    await act(async () => {
      finish({ documents: [doc], nextCursor: null });
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: `重新核對 ${doc.fileName} 的付款結果` }),
      ).toBeNull(),
    );
    expect(screen.getByText(/餘額：HK\$600.00/)).toBeTruthy();
    expect(screen.queryByRole("button", { name })).toBeNull();
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(f.getCase).toHaveBeenCalledTimes(2);
    expect(f.cases).toHaveBeenCalledTimes(1);
  },
);

it("keeps writes blocked after failed reconciliation and permits only a new explicit command with fresh proof/version", async () => {
  f.record.mockRejectedValueOnce(new Error("Response lost"));
  view();
  await screen.findByLabelText("憑證金額");
  fireEvent.change(screen.getByLabelText("憑證金額"), { target: { value: "600" } });
  fireEvent.change(screen.getByLabelText("憑證收款日期"), { target: { value: "2026-10-26" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存憑證資料" }));
  const recoveryName = `重新核對 ${doc.fileName} 的付款結果`;
  await screen.findByRole("button", { name: recoveryName });
  f.getCase.mockResolvedValue({ ...selectedCase, readiness: { sourceVersion: "b".repeat(32) } });
  f.documents.mockRejectedValueOnce(new Error("Document read failed"));
  fireEvent.click(screen.getByRole("button", { name: recoveryName }));
  await waitFor(() => expect(f.documents).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect((screen.getByRole("button", { name: recoveryName }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(screen.queryByLabelText("憑證金額")).toBeNull();
  expect(f.record).toHaveBeenCalledTimes(1);
  f.documents.mockResolvedValue({
    documents: [{ ...doc, currentVersionId: "fresh-proof" }],
    nextCursor: null,
  });
  fireEvent.click(screen.getByRole("button", { name: recoveryName }));
  await screen.findByLabelText("憑證金額");
  expect((screen.getByLabelText("憑證金額") as HTMLInputElement).value).toBe("");
  expect(f.record).toHaveBeenCalledTimes(1);
  f.record.mockImplementation(() => new Promise(() => {}));
  fireEvent.change(screen.getByLabelText("憑證金額"), { target: { value: "500" } });
  fireEvent.change(screen.getByLabelText("憑證收款日期"), { target: { value: "2026-10-26" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存憑證資料" }));
  await waitFor(() => expect(f.record).toHaveBeenCalledTimes(2));
  expect(f.record).toHaveBeenLastCalledWith({
    data: {
      caseId,
      paymentId: "payment-201",
      documentId: doc.id,
      proofVersionId: "fresh-proof",
      expectedVersion: "b".repeat(32),
      amount: "500",
      receivedOn: "2026-10-26",
    },
  });
});

it.each([null, new Error("denied"), { ...selectedCase, id: "wrong-case" }])(
  "does not unlock an unknown mutation result with unavailable case readback: %s",
  async (result) => {
    f.review.mockRejectedValue(new Error("Unknown result"));
    view();
    await screen.findByLabelText("具體退回原因");
    fireEvent.change(screen.getByLabelText("具體退回原因"), { target: { value: "Unreadable" } });
    fireEvent.click(screen.getByRole("button", { name: "退回補傳" }));
    const name = `重新核對 ${doc.fileName} 的付款結果`;
    await screen.findByRole("button", { name });
    if (result instanceof Error) f.getCase.mockRejectedValue(result);
    else f.getCase.mockResolvedValue(result);
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(f.getCase).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.queryByRole("button", { name: "退回補傳" })).toBeNull();
    expect(f.review).toHaveBeenCalledTimes(1);
    expect(f.record).not.toHaveBeenCalled();
  },
);

it("blocks every proof for the same uncertain case, even if the failed proof disappears", async () => {
  const second = { ...doc, id: "second-proof", fileName: "second.pdf" };
  f.documents.mockResolvedValue({ documents: [doc, second], nextCursor: null });
  f.review.mockRejectedValue(new Error("Unknown result"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  view("qa-team-a", client);
  await screen.findAllByLabelText("具體退回原因");
  const first = within(screen.getAllByRole("article")[0]);
  fireEvent.change(first.getByLabelText("具體退回原因"), { target: { value: "Unreadable" } });
  fireEvent.click(first.getByRole("button", { name: "退回補傳" }));
  await screen.findByRole("button", { name: `重新核對 ${doc.fileName} 的付款結果` });
  expect(screen.queryByRole("button", { name: "退回補傳" })).toBeNull();
  f.documents.mockResolvedValue({ documents: [second], nextCursor: null });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["annual-returns", "payment"] });
  });
  expect(screen.getByRole("button", { name: "重新核對 second.pdf 的付款結果" })).toBeTruthy();
  expect(screen.queryByLabelText("憑證金額")).toBeNull();
  expect(f.review).toHaveBeenCalledTimes(1);
  client.clear();
});

it("refreshes the original proof page instead of joining pending pagination during reconciliation", async () => {
  let finishNext!: (value: unknown) => void;
  f.documents
    .mockResolvedValueOnce({ documents: [doc], nextCursor: "next" })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNext = resolve;
        }),
    )
    .mockResolvedValue({ documents: [{ ...doc, uploadStatus: "rejected" }], nextCursor: null });
  f.review.mockRejectedValue(new Error("Unknown result"));
  view();
  await screen.findByLabelText("具體退回原因");
  fireEvent.click(screen.getByRole("button", { name: "載入更多付款憑證" }));
  await waitFor(() => expect(f.documents).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText("具體退回原因"), { target: { value: "Unreadable" } });
  fireEvent.click(screen.getByRole("button", { name: "退回補傳" }));
  const name = `重新核對 ${doc.fileName} 的付款結果`;
  fireEvent.click(await screen.findByRole("button", { name }));
  await act(async () => {
    finishNext({ documents: [], nextCursor: null });
  });
  await waitFor(() => expect(f.documents).toHaveBeenCalledTimes(3));
  expect(f.documents).toHaveBeenLastCalledWith({
    data: { category: "payment", limit: 100, cursor: undefined },
  });
  await waitFor(() => expect(screen.queryByRole("button", { name })).toBeNull());
  expect((screen.getByRole("button", { name: "退回補傳" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(f.review).toHaveBeenCalledTimes(1);
});

it("serializes reconciliation across proof rows sharing the document read", async () => {
  f.documents.mockResolvedValue({
    documents: [doc, { ...doc, id: "second", fileName: "second.pdf" }],
    nextCursor: null,
  });
  f.review.mockRejectedValue(new Error("Unknown result"));
  view();
  await screen.findAllByLabelText("具體退回原因");
  fireEvent.change(screen.getAllByLabelText("具體退回原因")[0], {
    target: { value: "Unreadable" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "退回補傳" })[0]);
  const first = await screen.findByRole("button", { name: `重新核對 ${doc.fileName} 的付款結果` });
  let finish!: (value: unknown) => void;
  f.documents.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    first.click();
    screen.getByRole("button", { name: "重新核對 second.pdf 的付款結果" }).click();
  });
  await waitFor(() => expect(f.documents).toHaveBeenCalledTimes(2));
  expect(
    (screen.getByRole("button", { name: "重新核對 second.pdf 的付款結果" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(async () => {
    finish({ documents: [doc], nextCursor: null });
  });
  await screen.findByLabelText("憑證金額");
  expect(f.review).toHaveBeenCalledTimes(1);
});
