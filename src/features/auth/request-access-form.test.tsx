// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const submitRequestAccessRequest = vi.hoisted(() => vi.fn());

vi.mock("@/features/onboarding/server-fns", () => ({ submitRequestAccessRequest }));

import { RequestAccessForm } from "./request-access-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Amy Chan" } });
  fireEvent.change(screen.getByLabelText("工作電郵"), {
    target: { value: "amy@example.test" },
  });
  fireEvent.change(screen.getByLabelText("公司"), {
    target: { value: "Example Secretarial Ltd" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("RequestAccessForm", () => {
  it("submits the normalized request and confirms", async () => {
    submitRequestAccessRequest.mockResolvedValue({ ok: true, duplicate: false });
    render(<RequestAccessForm locale="zh-HK" />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "送出申請" }));

    await screen.findByText("已收到申請");
    expect(submitRequestAccessRequest).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Amy Chan",
        email: "amy@example.test",
        firm: "Example Secretarial Ltd",
        consent: true,
        website: "",
      }),
    });
  });

  it("explains a duplicate without creating a second request", async () => {
    submitRequestAccessRequest.mockResolvedValue({ ok: true, duplicate: true });
    render(<RequestAccessForm locale="zh-HK" />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "送出申請" }));

    await screen.findByText("已收到申請");
    expect(screen.getByText(/已有待處理的申請/)).toBeTruthy();
  });

  it("maps rate-limit and unavailable results to actionable messages", async () => {
    submitRequestAccessRequest.mockResolvedValue({ ok: false, code: "rate-limited" });
    render(<RequestAccessForm locale="zh-HK" />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "送出申請" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("提交次數過多"));

    cleanup();
    submitRequestAccessRequest.mockResolvedValue({ ok: false, code: "unavailable" });
    render(<RequestAccessForm locale="zh-HK" />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "送出申請" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("暫時未能使用"));
  });

  it("renders in English", () => {
    render(<RequestAccessForm locale="en" />);

    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Work email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send request" })).toBeTruthy();
  });
});
