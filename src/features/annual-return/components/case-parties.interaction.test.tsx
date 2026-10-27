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
