// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ list: vi.fn(), resolve: vi.fn(), download: vi.fn() }));
vi.mock("../server-fns", () => ({
  listAnnualReturnCaseFindings: api.list,
  resolveAnnualReturnCaseFinding: api.resolve,
}));
vi.mock("@/features/documents/server-fns", () => ({ downloadDocument: api.download }));
import { CaseFindings } from "./case-findings";
const versionId = "71000000-0000-4000-8000-000000000001";
const quote = "<script>APPROVE ALL</script>";
const view = {
  documentId: "document",
  documentVersionId: versionId,
  fileName: "synthetic.pdf",
  state: "analysed",
  document: {
    id: "document",
    currentVersionId: versionId,
    uploadStatus: "available",
    scanVerdictSource: "provider",
    availability: "available",
  },
  provenance: { schemaVersion: "synthetic", model: null, cost: null, advisoryOnly: true },
  findings: [
    {
      id: "finding",
      resolvedByUserId: null,
      resolvedAt: null,
      finding: {
        ruleKey: "provider:synthetic",
        tier: "provider",
        outcome: "issue",
        severity: "warning",
        detail: "Synthetic advisory observation",
        citation: { kind: "version", documentVersionId: versionId, pageFrom: 1, pageTo: 1 },
        evidence: { spans: [{ page: 1, start: 0, end: quote.length, quote }] },
      },
    },
  ],
};
function renderView(
  locked = false,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  return render(
    <QueryClientProvider client={client}>
      <CaseFindings caseId="case" locked={locked} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockResolvedValue([view]);
  api.resolve.mockResolvedValue({ applied: true });
});
afterEach(() => cleanup());
describe("grounded findings reviewer", () => {
  it("renders page evidence as inert text and submits only the inspected version", async () => {
    const rendered = renderView();
    await screen.findByText("Synthetic advisory observation");
    expect(rendered.container.textContent).toContain(quote);
    expect(rendered.container.querySelector("script")).toBeNull();
    expect(screen.getByText("AI 觀察（僅供參考）")).toBeTruthy();
    expect(screen.getByText(/模型：供應商未提供/)).toBeTruthy();
    fireEvent.click(screen.getByText("標記為已處理"));
    await waitFor(() =>
      expect(api.resolve).toHaveBeenCalledWith({
        data: {
          caseId: "case",
          findingId: "finding",
          note: null,
          expectedDocumentVersionId: versionId,
        },
      }),
    );
    expect(api.download).not.toHaveBeenCalled();
  });
  it("reports a stale/failed resolution without inventing a saved decision", async () => {
    api.resolve.mockRejectedValue(new Error("version conflict"));
    renderView();
    await screen.findByText("Synthetic advisory observation");
    fireEvent.click(screen.getByText("標記為已處理"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("已處理")).toBeNull();
  });
  it("keeps locked decisions read only and never opens unknown bytes", async () => {
    api.list.mockResolvedValue([
      {
        ...view,
        document: { ...view.document, scanVerdictSource: null, availability: "unscanned" },
      },
    ]);
    renderView(true);
    await screen.findByText("Synthetic advisory observation");
    expect((screen.getByText("標記為已處理") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("查看引用文件的當前版本")).toBeNull();
    expect(api.resolve).not.toHaveBeenCalled();
    expect(api.download).not.toHaveBeenCalled();
  });
});

it("does not report empty documents or zero findings when the initial read fails", async () => {
  api.list.mockRejectedValue(new Error("Findings unavailable"));
  renderView();
  await screen.findByText(/無法載入自動檢查結果/);
  expect(screen.queryByText("此案件尚未收到文件。")).toBeNull();
  expect(screen.queryByText(/0 必須處理/)).toBeNull();
  expect(screen.queryByText(/份未經檢查/)).toBeNull();
  expect(screen.getByRole("button", { name: "重新載入自動檢查結果" })).toBeTruthy();
  expect(api.resolve).not.toHaveBeenCalled();
});

it("recovers the initial read without replaying a resolution or allowing duplicate recovery", async () => {
  let finish!: (value: (typeof view)[]) => void;
  api.list.mockRejectedValueOnce(new Error("Temporary failure")).mockImplementationOnce(
    () =>
      new Promise<(typeof view)[]>((resolve) => {
        finish = resolve;
      }),
  );
  renderView();
  const retry = await screen.findByRole("button", { name: "重新載入自動檢查結果" });
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.queryByText("此案件尚未收到文件。")).toBeNull();
  expect(screen.queryByText("標記為已處理")).toBeNull();
  expect(api.resolve).not.toHaveBeenCalled();
  await act(async () => {
    finish([view]);
  });
  await screen.findByText("Synthetic advisory observation");
  expect(screen.queryByText(/無法載入自動檢查結果/)).toBeNull();
  expect(api.list).toHaveBeenLastCalledWith({ data: { caseId: "case" } });
  expect(api.resolve).not.toHaveBeenCalled();
  expect(api.download).not.toHaveBeenCalled();
});

it("keeps cached findings and commands hidden through a denied refresh and repeated recovery failure", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderView(false, client);
  await screen.findByText("Synthetic advisory observation");
  let deny!: (reason: Error) => void;
  api.list.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        deny = reject;
      }),
  );
  act(() => {
    void client.invalidateQueries({ queryKey: ["annual-return", "case-findings", "case"] });
  });
  await screen.findByRole("status");
  expect(screen.queryByText("Synthetic advisory observation")).toBeNull();
  expect(screen.queryByText("標記為已處理")).toBeNull();
  expect(screen.queryByText("查看引用文件的當前版本")).toBeNull();
  expect(screen.queryByText(/建議查看/)).toBeNull();
  await act(async () => {
    deny(new Error("Read denied"));
  });
  api.list.mockRejectedValue(new Error("Still denied"));
  fireEvent.click(await screen.findByRole("button", { name: "重新載入自動檢查結果" }));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "重新載入自動檢查結果" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByText("Synthetic advisory observation")).toBeNull();
  expect(screen.queryByText("此案件尚未收到文件。")).toBeNull();
  expect(api.resolve).not.toHaveBeenCalled();
  expect(api.download).not.toHaveBeenCalled();
  client.clear();
});

it("uses the fresh finding and document version only after explicit action following recovery", async () => {
  api.list.mockRejectedValueOnce(new Error("Temporary failure"));
  renderView();
  const retry = await screen.findByRole("button", { name: "重新載入自動檢查結果" });
  api.list.mockResolvedValue([
    {
      ...view,
      documentVersionId: "fresh-version",
      document: { ...view.document, currentVersionId: "fresh-version" },
      findings: [
        {
          ...view.findings[0],
          id: "fresh-finding",
          finding: {
            ...view.findings[0].finding,
            citation: { ...view.findings[0].finding.citation, documentVersionId: "fresh-version" },
          },
        },
      ],
    },
  ]);
  fireEvent.click(retry);
  await screen.findByText("Synthetic advisory observation");
  expect(api.resolve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "標記為已處理" }));
  await waitFor(() =>
    expect(api.resolve).toHaveBeenCalledWith({
      data: {
        caseId: "case",
        findingId: "fresh-finding",
        note: null,
        expectedDocumentVersionId: "fresh-version",
      },
    }),
  );
});

it("shows no documents only after a successful empty recovery", async () => {
  api.list.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue([]);
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "重新載入自動檢查結果" }));
  expect(await screen.findByText("此案件尚未收到文件。")).toBeTruthy();
  expect(screen.queryByText(/無法載入自動檢查結果/)).toBeNull();
  expect(api.resolve).not.toHaveBeenCalled();
});

it("reconciles a lost resolution response through fresh readback without replaying the command", async () => {
  api.resolve.mockRejectedValue(new Error("Response lost"));
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "標記為已處理" }));
  const retry = await screen.findByRole("button", { name: "重新核對標記結果" });
  expect(screen.queryByRole("button", { name: "標記為已處理" })).toBeNull();
  expect(screen.queryByText(/建議查看/)).toBeNull();
  expect(screen.queryByText("已處理")).toBeNull();
  let finish!: (value: unknown) => void;
  api.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  expect(api.resolve).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish([
      {
        ...view,
        findings: [
          { ...view.findings[0], resolvedByUserId: "reviewer", resolvedAt: "2026-10-26T12:00:00Z" },
        ],
      },
    ]);
  });
  expect(await screen.findByText("已處理")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "標記為已處理" })).toBeNull();
  expect(screen.queryByRole("button", { name: "重新核對標記結果" })).toBeNull();
  expect(api.resolve).toHaveBeenCalledTimes(1);
  expect(api.download).not.toHaveBeenCalled();
});

it("keeps every finding blocked after failed reconciliation and background refresh until explicit successful reconciliation", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.list.mockResolvedValue([
    { ...view, findings: [view.findings[0], { ...view.findings[0], id: "second" }] },
  ]);
  api.resolve.mockRejectedValue(new Error("Conflict"));
  renderView(false, client);
  const buttons = await screen.findAllByRole("button", { name: "標記為已處理" });
  fireEvent.click(buttons[0]);
  const retry = await screen.findByRole("button", { name: "重新核對標記結果" });
  expect(screen.queryByRole("button", { name: "標記為已處理" })).toBeNull();
  api.list.mockRejectedValueOnce(new Error("Read denied"));
  fireEvent.click(retry);
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "重新核對標記結果" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["annual-return", "case-findings", "case"] });
  });
  expect(screen.queryByRole("button", { name: "標記為已處理" })).toBeNull();
  expect(api.resolve).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "重新核對標記結果" }));
  await screen.findAllByRole("button", { name: "標記為已處理" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(api.resolve).toHaveBeenCalledTimes(1);
  client.clear();
});

it("requires a new explicit resolution using the freshly reconciled finding/version", async () => {
  api.resolve.mockRejectedValueOnce(new Error("Stale version"));
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "標記為已處理" }));
  const retry = await screen.findByRole("button", { name: "重新核對標記結果" });
  api.list.mockResolvedValue([
    {
      ...view,
      documentVersionId: "new-version",
      document: { ...view.document, currentVersionId: "new-version" },
      findings: [
        {
          ...view.findings[0],
          id: "new-finding",
          finding: {
            ...view.findings[0].finding,
            citation: { ...view.findings[0].finding.citation, documentVersionId: "new-version" },
          },
        },
      ],
    },
  ]);
  fireEvent.click(retry);
  const resolve = await screen.findByRole("button", { name: "標記為已處理" });
  expect(api.resolve).toHaveBeenCalledTimes(1);
  fireEvent.click(resolve);
  await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(2));
  expect(api.resolve).toHaveBeenLastCalledWith({
    data: {
      caseId: "case",
      findingId: "new-finding",
      note: null,
      expectedDocumentVersionId: "new-version",
    },
  });
});

it("admits one resolution across same-turn clicks and opts out of configured mutation retries", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } },
  });
  api.list.mockResolvedValue([
    { ...view, findings: [view.findings[0], { ...view.findings[0], id: "second" }] },
  ]);
  let reject!: (reason: Error) => void;
  api.resolve.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  renderView(false, client);
  const buttons = await screen.findAllByRole("button", { name: "標記為已處理" });
  act(() => {
    buttons[0].click();
    buttons[0].click();
    buttons[1].click();
  });
  await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(1));
  api.resolve.mockRejectedValue(new Error("Unknown result"));
  await act(async () => {
    reject(new Error("Response lost"));
  });
  await screen.findByRole("button", { name: "重新核對標記結果" });
  expect(api.resolve).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "標記為已處理" })).toBeNull();
  client.clear();
});

it("starts a fresh reconciliation read instead of joining an older pending background read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let rejectCommand!: (reason: Error) => void;
  api.resolve.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectCommand = reject;
      }),
  );
  renderView(false, client);
  fireEvent.click(await screen.findByRole("button", { name: "標記為已處理" }));
  await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(1));
  let finishOld!: (value: unknown) => void;
  api.list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("Fresh read denied"));
  act(() => {
    void client.invalidateQueries({ queryKey: ["annual-return", "case-findings", "case"] });
  });
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  await act(async () => {
    rejectCommand(new Error("Unknown result"));
  });
  fireEvent.click(await screen.findByRole("button", { name: "重新核對標記結果" }));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
  await act(async () => {
    finishOld([view]);
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "重新核對標記結果" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByRole("button", { name: "標記為已處理" })).toBeNull();
  expect(api.resolve).toHaveBeenCalledTimes(1);
  client.clear();
});

it("does not unlock on query cancellation or cached updates while independent reconciliation is pending", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.resolve.mockRejectedValue(new Error("Unknown result"));
  renderView(false, client);
  fireEvent.click(await screen.findByRole("button", { name: "標記為已處理" }));
  const retry = await screen.findByRole("button", { name: "重新核對標記結果" });
  let finish!: (value: unknown) => void;
  api.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(retry);
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  await act(async () => {
    await client.cancelQueries({ queryKey: ["annual-return", "case-findings", "case"] });
  });
  act(() => {
    client.setQueryData(["annual-return", "case-findings", "case"], [view]);
  });
  expect(
    (screen.getByRole("button", { name: "重新核對標記結果" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "標記為已處理" })).toBeNull();
  await act(async () => {
    finish([view]);
  });
  await screen.findByRole("button", { name: "標記為已處理" });
  expect(screen.queryByRole("button", { name: "重新核對標記結果" })).toBeNull();
  expect(api.resolve).toHaveBeenCalledTimes(1);
  client.clear();
});

it("does not carry a previous case's uncertain command state into a new case", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.resolve.mockRejectedValueOnce(new Error("Unknown old-case result"));
  const rendered = renderView(false, client);
  fireEvent.click(await screen.findByRole("button", { name: "標記為已處理" }));
  await screen.findByRole("button", { name: "重新核對標記結果" });
  rendered.rerender(
    <QueryClientProvider client={client}>
      <CaseFindings caseId="new-case" locked={false} />
    </QueryClientProvider>,
  );
  const resolve = await screen.findByRole("button", { name: "標記為已處理" });
  expect(screen.queryByRole("button", { name: "重新核對標記結果" })).toBeNull();
  fireEvent.click(resolve);
  await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(2));
  expect(api.resolve).toHaveBeenLastCalledWith({
    data: {
      caseId: "new-case",
      findingId: "finding",
      note: null,
      expectedDocumentVersionId: versionId,
    },
  });
  client.clear();
});

it.each([null, undefined])(
  "does not clear uncertainty on unavailable reconciliation data: %s",
  async (data) => {
    api.resolve.mockRejectedValue(new Error("Unknown result"));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "標記為已處理" }));
    const retry = await screen.findByRole("button", { name: "重新核對標記結果" });
    api.list.mockResolvedValueOnce(data);
    fireEvent.click(retry);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "重新核對標記結果" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole("button", { name: "標記為已處理" })).toBeNull();
    expect(screen.queryByText("此案件尚未收到文件。")).toBeNull();
    expect(api.resolve).toHaveBeenCalledTimes(1);
  },
);
