// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({ createClient: vi.fn(), updateClient: vi.fn() }));
vi.mock("@/features/clients/server-fns", () => serverFns);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ClientFormDialog } from "./client-form-dialog";

const options = {
  owners: [{ id: "20000000-0000-0000-0000-000000000001", name: "Amy Chan", teamId: null }],
  teams: [{ id: "10000000-0000-0000-0000-000000000001", name: "Annual Return Control" }],
};

function fillRequired(cr: string, br: string) {
  fireEvent.change(screen.getByLabelText(/公司名稱/), { target: { value: "Flow Test Limited" } });
  fireEvent.change(screen.getByLabelText("CR 號碼"), { target: { value: cr } });
  fireEvent.change(screen.getByLabelText("BR 號碼"), { target: { value: br } });
}

describe("ClientFormDialog identifier checks", () => {
  beforeEach(() => serverFns.createClient.mockReset());
  afterEach(cleanup);

  it("stops a malformed CR number at the field instead of saving it", () => {
    // A company was saved with CR "12" and BR "abc"; both columns are unique, so
    // the bad value then blocked the real number.
    render(<ClientFormDialog open onOpenChange={() => {}} options={options} onSaved={() => {}} />);
    fillRequired("12", "60000138");
    fireEvent.submit(screen.getByRole("button", { name: "新增客戶" }).closest("form")!);

    const cr = screen.getByLabelText("CR 號碼");
    expect(cr.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("textbox", { name: "CR 號碼", description: /7 或 8 位數字/ })).toBe(cr);
    expect(serverFns.createClient).not.toHaveBeenCalled();
  });

  it("stops a malformed BR number at the field", () => {
    render(<ClientFormDialog open onOpenChange={() => {}} options={options} onSaved={() => {}} />);
    fillRequired("1200042", "abc");
    fireEvent.submit(screen.getByRole("button", { name: "新增客戶" }).closest("form")!);

    expect(screen.getByLabelText("BR 號碼").getAttribute("aria-invalid")).toBe("true");
    expect(serverFns.createClient).not.toHaveBeenCalled();
  });
});
