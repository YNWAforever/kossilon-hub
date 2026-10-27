// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ list: vi.fn(), confirm: vi.fn() }));
vi.mock("../server-fns", () => ({
  listAnnualReturnCaseParties: api.list,
  confirmAnnualReturnCaseParty: api.confirm,
}));
import { CaseParties } from "./case-parties";
const party = {
  id: "party-old",
  displayName: "Officer A",
  active: true,
  confirmedByUserId: null,
  partyType: "director",
  officerId: "officer-a",
};
function view(
  locked = false,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  return render(
    <QueryClientProvider client={client}>
      <CaseParties caseId="case-a" locked={locked} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockResolvedValue([party]);
  api.confirm.mockResolvedValue({});
});
afterEach(cleanup);

it("does not infer zero confirmed people or an empty officer register from a failed read", async () => {
  api.list.mockRejectedValue(new Error("Read failed"));
  view();
  await screen.findByText(/無法載入相關人士名單/);
  expect(screen.queryByText("0/0 已確認")).toBeNull();
  expect(screen.queryByText(/公司董事名冊沒有在任人士/)).toBeNull();
  expect(screen.getByRole("button", { name: "重新載入相關人士" })).toBeTruthy();
  expect(api.confirm).not.toHaveBeenCalled();
});

it("deduplicates list recovery while pending and restores fresh candidates without confirming them", async () => {
  let finish!: (value: unknown) => void;
  api.list.mockRejectedValueOnce(new Error("Temporary failure")).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  view();
  const retry = await screen.findByRole("button", { name: "重新載入相關人士" });
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "確認為相關人士" })).toBeNull();
  await act(async () => {
    finish([{ ...party, id: "fresh-party", displayName: "Officer B" }]);
  });
  await screen.findByText("Officer B");
  expect(screen.queryByText("Officer A")).toBeNull();
  expect(screen.getByText("0/1 已確認")).toBeTruthy();
  expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "確認為相關人士" }));
  await waitFor(() =>
    expect(api.confirm).toHaveBeenCalledWith({
      data: { caseId: "case-a", partyId: "fresh-party" },
    }),
  );
});

it("hides cached names, completeness warnings and confirmation controls during a denied refresh and failed retry", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  view(false, client);
  await screen.findByText("Officer A");
  let reject!: (reason: Error) => void;
  api.list.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  act(() => {
    void client.invalidateQueries({ queryKey: ["annual-return", "case-parties", "case-a"] });
  });
  await screen.findByRole("status");
  expect(screen.queryByText("Officer A")).toBeNull();
  expect(screen.queryByText("0/1 已確認")).toBeNull();
  expect(screen.queryByText(/尚有 1/)).toBeNull();
  expect(screen.queryByRole("button", { name: "確認為相關人士" })).toBeNull();
  await act(async () => {
    reject(new Error("Denied"));
  });
  api.list.mockRejectedValue(new Error("Still denied"));
  fireEvent.click(await screen.findByRole("button", { name: "重新載入相關人士" }));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "重新載入相關人士" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByText("Officer A")).toBeNull();
  expect(screen.queryByText(/公司董事名冊沒有在任人士/)).toBeNull();
  expect(api.confirm).not.toHaveBeenCalled();
  client.clear();
});

it("shows an empty officer register only after successful empty recovery", async () => {
  api.list.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue([]);
  view();
  fireEvent.click(await screen.findByRole("button", { name: "重新載入相關人士" }));
  expect(await screen.findByText(/公司董事名冊沒有在任人士/)).toBeTruthy();
  expect(screen.getByText("0/0 已確認")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(api.confirm).not.toHaveBeenCalled();
});

it("keeps recovered candidates read only when the case is locked", async () => {
  api.list.mockRejectedValueOnce(new Error("Temporary failure"));
  view(true);
  fireEvent.click(await screen.findByRole("button", { name: "重新載入相關人士" }));
  expect(
    ((await screen.findByRole("button", { name: "確認為相關人士" })) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(api.confirm).not.toHaveBeenCalled();
});

it("reads back a saved confirmation after response loss without replay and refreshes dependent findings", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const findingsKey = ["annual-return", "case-findings", "case-a"];
  client.setQueryData(findingsKey, []);
  api.confirm.mockRejectedValue(new Error("Response lost"));
  view(false, client);
  fireEvent.click(await screen.findByRole("button", { name: "確認為相關人士" }));
  const retry = await screen.findByRole("button", { name: "重新核對確認結果" });
  expect(screen.queryByRole("button", { name: "確認為相關人士" })).toBeNull();
  expect(screen.queryByText("0/1 已確認")).toBeNull();
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
  expect(api.confirm).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish([{ ...party, confirmedByUserId: "reviewer" }]);
  });
  expect(await screen.findByText("1/1 已確認")).toBeTruthy();
  expect(screen.getByText("已確認")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "確認為相關人士" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(client.getQueryState(findingsKey)?.isInvalidated).toBe(true);
  expect(api.confirm).toHaveBeenCalledTimes(1);
  client.clear();
});

it("keeps every candidate blocked after failed recovery and ordinary background success", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.list.mockResolvedValue([party, { ...party, id: "second", displayName: "Officer B" }]);
  api.confirm.mockRejectedValue(new Error("Unknown result"));
  view(false, client);
  fireEvent.click((await screen.findAllByRole("button", { name: "確認為相關人士" }))[0]);
  const retry = await screen.findByRole("button", { name: "重新核對確認結果" });
  api.list.mockRejectedValueOnce(new Error("Read denied"));
  fireEvent.click(retry);
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "重新核對確認結果" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["annual-return", "case-parties", "case-a"] });
  });
  expect(screen.queryByRole("button", { name: "確認為相關人士" })).toBeNull();
  expect(screen.queryByText("Officer B")).toBeNull();
  expect(api.confirm).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "重新核對確認結果" }));
  await screen.findAllByRole("button", { name: "確認為相關人士" });
  expect(api.confirm).toHaveBeenCalledTimes(1);
  client.clear();
});

it("requires a new explicit confirmation using the fresh candidate after reconciliation", async () => {
  api.confirm.mockRejectedValueOnce(new Error("Stale candidate"));
  view();
  fireEvent.click(await screen.findByRole("button", { name: "確認為相關人士" }));
  const retry = await screen.findByRole("button", { name: "重新核對確認結果" });
  api.list.mockResolvedValue([{ ...party, id: "fresh-party", displayName: "Officer B" }]);
  fireEvent.click(retry);
  const confirm = await screen.findByRole("button", { name: "確認為相關人士" });
  expect(api.confirm).toHaveBeenCalledTimes(1);
  fireEvent.click(confirm);
  await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(2));
  expect(api.confirm).toHaveBeenLastCalledWith({
    data: { caseId: "case-a", partyId: "fresh-party" },
  });
});

it("guards same-turn confirmations across candidates and overrides configured mutation retries", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } },
  });
  api.list.mockResolvedValue([party, { ...party, id: "second", displayName: "Officer B" }]);
  let reject!: (reason: Error) => void;
  api.confirm.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  view(false, client);
  const buttons = await screen.findAllByRole("button", { name: "確認為相關人士" });
  act(() => {
    buttons[0].click();
    buttons[0].click();
    buttons[1].click();
  });
  await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(1));
  api.confirm.mockRejectedValue(new Error("Unknown result"));
  await act(async () => {
    reject(new Error("Response lost"));
  });
  await screen.findByRole("button", { name: "重新核對確認結果" });
  expect(api.confirm).toHaveBeenCalledTimes(1);
  client.clear();
});

it("reconciles independently of an older pending list read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let reject!: (reason: Error) => void;
  api.confirm.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  view(false, client);
  fireEvent.click(await screen.findByRole("button", { name: "確認為相關人士" }));
  await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(1));
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
    void client.invalidateQueries({ queryKey: ["annual-return", "case-parties", "case-a"] });
  });
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  await act(async () => {
    reject(new Error("Unknown result"));
  });
  fireEvent.click(await screen.findByRole("button", { name: "重新核對確認結果" }));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
  await act(async () => {
    finishOld([party]);
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "重新核對確認結果" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByRole("button", { name: "確認為相關人士" })).toBeNull();
  expect(api.confirm).toHaveBeenCalledTimes(1);
  client.clear();
});

it("does not unlock from query cancellation or cache updates while the independent recovery read is pending", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.confirm.mockRejectedValue(new Error("Unknown result"));
  view(false, client);
  fireEvent.click(await screen.findByRole("button", { name: "確認為相關人士" }));
  const retry = await screen.findByRole("button", { name: "重新核對確認結果" });
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
    await client.cancelQueries({ queryKey: ["annual-return", "case-parties", "case-a"] });
  });
  act(() => {
    client.setQueryData(["annual-return", "case-parties", "case-a"], [party]);
  });
  expect(
    (screen.getByRole("button", { name: "重新核對確認結果" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "確認為相關人士" })).toBeNull();
  await act(async () => {
    finish([party]);
  });
  await screen.findByRole("button", { name: "確認為相關人士" });
  expect(api.confirm).toHaveBeenCalledTimes(1);
  client.clear();
});

it.each([null, undefined])(
  "keeps confirmations blocked on unavailable recovery data: %s",
  async (data) => {
    api.confirm.mockRejectedValue(new Error("Unknown result"));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "確認為相關人士" }));
    const retry = await screen.findByRole("button", { name: "重新核對確認結果" });
    api.list.mockResolvedValueOnce(data);
    fireEvent.click(retry);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "重新核對確認結果" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole("button", { name: "確認為相關人士" })).toBeNull();
    expect(screen.queryByText(/公司董事名冊沒有在任人士/)).toBeNull();
    expect(api.confirm).toHaveBeenCalledTimes(1);
  },
);

it("does not carry uncertain confirmation state into a different case", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.confirm.mockRejectedValueOnce(new Error("Unknown old-case result"));
  const rendered = view(false, client);
  fireEvent.click(await screen.findByRole("button", { name: "確認為相關人士" }));
  await screen.findByRole("button", { name: "重新核對確認結果" });
  rendered.rerender(
    <QueryClientProvider client={client}>
      <CaseParties caseId="new-case" locked={false} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "確認為相關人士" }));
  await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(2));
  expect(api.confirm).toHaveBeenLastCalledWith({
    data: { caseId: "new-case", partyId: "party-old" },
  });
  client.clear();
});
