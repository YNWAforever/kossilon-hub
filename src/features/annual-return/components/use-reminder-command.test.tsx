// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAnnualReturnReminderCommand } from "./use-reminder-command";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../server-fns", () => ({ readAnnualReturnReminderCommand: mocks.read }));

const caseId = "11111111-1111-4111-8111-111111111111";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

type SendInput = { recipientName: string; recipientPhone: string; commandUuid: string };

function Harness({
  storage,
  send,
}: {
  storage: ReturnType<typeof memoryStorage>;
  send: (input: SendInput) => Promise<unknown>;
}) {
  const reminder = useAnnualReturnReminderCommand({
    caseId,
    actorScope: "actor-a",
    locked: false,
    sendReminder: send,
    storage: () => storage,
  });
  return (
    <div>
      <input
        aria-label="提醒收件人姓名"
        value={reminder.recipientName}
        onChange={(event) => reminder.setRecipientName(event.target.value)}
      />
      <input
        aria-label="提醒電話號碼"
        value={reminder.recipientPhone}
        onChange={(event) => reminder.setRecipientPhone(event.target.value)}
      />
      <button type="button" disabled={reminder.sendDisabled} onClick={() => reminder.send()}>
        發送提醒
      </button>
      {reminder.statusMessage ? <p role="status">{reminder.statusMessage}</p> : null}
      {reminder.showReconcile ? (
        <button type="button" onClick={() => void reminder.reconcile()}>
          核對提醒結果
        </button>
      ) : null}
      {reminder.showMutationError ? <p role="alert">{reminder.error?.message}</p> : null}
    </div>
  );
}

function renderHarness(
  storage: ReturnType<typeof memoryStorage>,
  send: (input: SendInput) => Promise<unknown>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <Wrapper>
      <Harness storage={storage} send={send} />
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function fill() {
  fireEvent.change(screen.getByLabelText("提醒收件人姓名"), { target: { value: "Ada Chan" } });
  fireEvent.change(screen.getByLabelText("提醒電話號碼"), { target: { value: "+85291234567" } });
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "發送提醒" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
}

describe("useAnnualReturnReminderCommand", () => {
  it("persists the command before the POST and does not retry the mutation", async () => {
    const storage = memoryStorage();
    const send = vi.fn(async (input: SendInput) => {
      expect([...storage.items.values()].join("\n")).toContain(input.commandUuid);
      throw new Error("lost response");
    });
    mocks.read.mockResolvedValue({ state: "absent" });
    renderHarness(storage, send);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await screen.findByText("此指令沒有登記。可再按發送，沿用同一指令。");
    expect(send).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledWith({
      data: { caseId, commandUuid: send.mock.calls[0][0].commandUuid },
    });
    expect(screen.getByRole("alert").textContent).toContain("lost response");
  });

  it("blocks a second click in the same turn", async () => {
    const storage = memoryStorage();
    let release: () => void = () => {};
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true });
        }),
    );
    mocks.read.mockResolvedValue({ state: "queued", messageId: "msg-1" });
    renderHarness(storage, send);
    await fill();
    const button = screen.getByRole("button", { name: "發送提醒" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await act(async () => release());
    await screen.findByText(/尚未確認送達/);
    expect(screen.getByText(/尚未確認送達/).textContent).toContain("msg-1");
    expect(screen.getByText(/尚未確認送達/).textContent).not.toContain("已送達客戶");
  });

  it("reuses the UUID while the command is absent and mints a new one after a receipt", async () => {
    const storage = memoryStorage();
    const send = vi.fn<(input: SendInput) => Promise<unknown>>(async () => {
      throw new Error("lost response");
    });
    mocks.read.mockResolvedValue({ state: "absent" });
    renderHarness(storage, send);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await screen.findByText(/沿用同一指令/);
    const first = send.mock.calls[0][0].commandUuid;
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0].commandUuid).toBe(first);
    await screen.findByText(/沿用同一指令/);

    mocks.read.mockResolvedValue({ state: "queued", messageId: "msg-2" });
    send.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await screen.findByText(/尚未確認送達/);
    expect(send.mock.calls[2][0].commandUuid).toBe(first);

    send.mockRejectedValue(new Error("lost response"));
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(4));
    expect(send.mock.calls[3][0].commandUuid).not.toBe(first);
  });

  it("keeps an absent command when only the phone formatting changes", async () => {
    const storage = memoryStorage();
    const send = vi.fn<(input: SendInput) => Promise<unknown>>(async () => {
      throw new Error("lost response while the server is still committing");
    });
    mocks.read.mockResolvedValue({ state: "absent" });
    renderHarness(storage, send);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await screen.findByText(/沿用同一指令/);
    const commandUuid = send.mock.calls[0][0].commandUuid;

    fireEvent.change(screen.getByLabelText("提醒電話號碼"), {
      target: { value: "+852 9123 4567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0].commandUuid).toBe(commandUuid);
    expect(send.mock.calls[1][0].recipientPhone).toBe("+852 9123 4567");
  });

  it("keeps the latest unresolved command ahead of an older spelling's cached receipt", async () => {
    const storage = memoryStorage();
    const send = vi.fn<(input: SendInput) => Promise<unknown>>(async () => ({ ok: true }));
    mocks.read.mockResolvedValue({ state: "queued", messageId: "msg-old" });
    renderHarness(storage, send);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await screen.findByText(/尚未確認送達/);

    fireEvent.change(screen.getByLabelText("提醒電話號碼"), {
      target: { value: "+852 9123 4567" },
    });
    mocks.read.mockResolvedValue({ state: "absent" });
    send.mockRejectedValue(new Error("lost response"));
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await screen.findByText(/沿用同一指令/);
    const unresolvedCommand = send.mock.calls[1][0].commandUuid;
    expect(unresolvedCommand).not.toBe(send.mock.calls[0][0].commandUuid);

    fireEvent.change(screen.getByLabelText("提醒電話號碼"), {
      target: { value: "+85291234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2][0].commandUuid).toBe(unresolvedCommand);
  });

  it("does not send again when the receipt read fails", async () => {
    const storage = memoryStorage();
    const send = vi.fn<(input: SendInput) => Promise<unknown>>(async () => {
      throw new Error("lost response");
    });
    mocks.read.mockRejectedValue(new Error("private SQL"));
    renderHarness(storage, send);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await screen.findByText("未能核對提醒結果。請先重試核對，不要再按發送。");
    expect(screen.queryByText("private SQL")).toBeNull();
    expect((screen.getByRole("button", { name: "發送提醒" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    mocks.read.mockResolvedValue({ state: "queued", messageId: "msg-3" });
    fireEvent.click(screen.getByRole("button", { name: "核對提醒結果" }));
    await screen.findByText(/尚未確認送達/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("restores the latest command on reload and reads it without posting", async () => {
    const storage = memoryStorage();
    const send = vi.fn<(input: SendInput) => Promise<unknown>>(async () => ({ ok: true }));
    mocks.read.mockResolvedValue({ state: "queued", messageId: "msg-4" });
    const first = renderHarness(storage, send);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));
    await screen.findByText(/尚未確認送達/);
    const commandUuid = send.mock.calls[0][0].commandUuid;
    first.unmount();
    send.mockClear();
    mocks.read.mockClear();
    renderHarness(storage, send);
    await screen.findByText(/尚未確認送達/);
    expect((screen.getByLabelText("提醒收件人姓名") as HTMLInputElement).value).toBe("Ada Chan");
    expect((screen.getByLabelText("提醒電話號碼") as HTMLInputElement).value).toBe("+85291234567");
    expect(send).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledWith({ data: { caseId, commandUuid } });
  });
});
