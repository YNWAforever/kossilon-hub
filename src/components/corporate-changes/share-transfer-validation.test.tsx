// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateCorporateChangeRequestDialog } from "./create-corporate-change-request-dialog";

const rpc = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
vi.mock("@/features/corporate-changes/server-fns", () => ({
  createCorporateChangeRequest: rpc.create,
}));
vi.mock("@/features/clients/server-fns", () => ({ getClient: rpc.get }));
const companyId = "f7337fb9-0166-4166-8166-000000000001";
const fromId = "f7337fb9-0166-4166-8166-000000000002";
const toId = "f7337fb9-0166-4166-8166-000000000003";
const created = vi.fn(),
  open = vi.fn();
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const change = (label: string, value: string) =>
  fireEvent.change(input(label), { target: { value } });
const submit = () => fireEvent.submit(input("轉讓股數").closest("form")!);
async function view() {
  render(
    <CreateCorporateChangeRequestDialog
      open
      onOpenChange={open}
      companies={[{ id: companyId, companyName: "QA UC166" }]}
      isLoading={false}
      hasError={false}
      onCreated={created}
    />,
  );
  change("公司", companyId);
  change("變更類別", "share_transfer");
  await screen.findByRole("option", { name: "QA Transferor", hidden: true });
  change("報價（HKD）", "2500");
  change("轉讓人股權", fromId);
  change("新股東名稱", "QA New Holder");
  change("轉讓股數", "10");
  change("代價（HKD）", "0");
  change("印花稅（HKD）", "0");
}
function expectFieldError(label: string) {
  const field = input(label);
  expect(field.getAttribute("aria-invalid")).toBe("true");
  const described = field.getAttribute("aria-describedby");
  expect(described).toBeTruthy();
  expect(document.getElementById(described!)?.textContent).toMatch(/請|股|數量/);
}
beforeEach(() => {
  vi.resetAllMocks();
  rpc.get.mockResolvedValue({
    officers: [],
    shareholdings: [
      { id: fromId, shareholderName: "QA Transferor", numberOfShares: 100, cessationDate: null },
      { id: toId, shareholderName: "QA Existing", numberOfShares: 10, cessationDate: null },
    ],
  });
  rpc.create.mockResolvedValue({ id: "f7337fb9-0166-4166-8166-000000000099" });
});
afterEach(cleanup);
describe("UC166 share transfer dialog rejection", () => {
  it("explains a blank new holder on blur while numeric fields are still empty", async () => {
    render(
      <CreateCorporateChangeRequestDialog
        open
        onOpenChange={open}
        companies={[{ id: companyId, companyName: "QA UC166" }]}
        isLoading={false}
        hasError={false}
        onCreated={created}
      />,
    );
    change("公司", companyId);
    change("變更類別", "share_transfer");
    await screen.findByRole("option", { name: "QA Transferor", hidden: true });
    fireEvent.blur(input("新股東名稱"));
    await waitFor(() => expectFieldError("新股東名稱"));
    expect(rpc.create).not.toHaveBeenCalled();
  });
  it.each(["", "   "])("missing new holder %j is linked to field and never sent", async (name) => {
    await view();
    change("新股東名稱", name);
    submit();
    await waitFor(() => expectFieldError("新股東名稱"));
    expect(document.activeElement).toBe(input("新股東名稱"));
    expect(rpc.create).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
    expect(input("報價（HKD）").value).toBe("2500");
  });
  it.each(["0", "-1", "1.5", "2147483648"])(
    "quantity %s has a field error and no RPC",
    async (value) => {
      await view();
      change("轉讓股數", value);
      submit();
      await waitFor(() => expectFieldError("轉讓股數"));
      expect(document.activeElement).toBe(input("轉讓股數"));
      expect(rpc.create).not.toHaveBeenCalled();
      expect(created).not.toHaveBeenCalled();
    },
  );
  it("blur gives a missing existing-holder field explanation despite disabled submit", async () => {
    await view();
    fireEvent.click(screen.getByLabelText("現有股東"));
    fireEvent.blur(input("承讓人股權"));
    await waitFor(() => expectFieldError("承讓人股權"));
    expect(rpc.create).not.toHaveBeenCalled();
  });
  it("switching modes sends only the active transferee and correction allows retry", async () => {
    await view();
    change("轉讓股數", "-1");
    submit();
    await waitFor(() => expectFieldError("轉讓股數"));
    change("轉讓股數", "10");
    fireEvent.click(screen.getByLabelText("現有股東"));
    change("承讓人股權", toId);
    submit();
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(rpc.create).toHaveBeenCalledTimes(1);
    expect(rpc.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transfereeShareholdingId: toId,
        transfereeNewShareholderName: null,
        transfereeNewShareholderAddress: null,
        sharesTransferred: 10,
      }),
    });
  });
  it("hides raw server details, retains inputs, then retries once", async () => {
    await view();
    rpc.create.mockRejectedValueOnce(new Error("db.internal SQL token=QA-UC166"));
    submit();
    await screen.findByRole("alert");
    expect(document.body.textContent).not.toMatch(/db\.internal|SQL|token=/);
    expect(input("新股東名稱").value).toBe("QA New Holder");
    expect(created).not.toHaveBeenCalled();
    submit();
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(rpc.create).toHaveBeenCalledTimes(2);
  });
  it("deduplicates two pending submits and cancel never submits", async () => {
    await view();
    let release!: (value: { id: string }) => void;
    rpc.create.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    submit();
    submit();
    await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(1));
    await act(async () => release({ id: "f7337fb9-0166-4166-8166-000000000099" }));
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    cleanup();
    await view();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(rpc.create).toHaveBeenCalledTimes(1);
  });
});
