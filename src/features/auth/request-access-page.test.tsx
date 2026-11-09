// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/onboarding/server-fns", () => ({ submitRequestAccessRequest: vi.fn() }));

import { RequestAccessPage } from "./request-access-page";

afterEach(cleanup);

describe("RequestAccessPage fallback", () => {
  it("keeps the mailto CTA until persistence is available", () => {
    render(<RequestAccessPage locale="zh-HK" formAvailable={false} />);

    const link = screen.getByRole("link", { name: "電郵公司管理員" });
    expect(link.getAttribute("href")).toContain("mailto:");
    expect(screen.queryByLabelText("姓名")).toBeNull();
  });

  it("renders the persisted form when the table is available", () => {
    render(<RequestAccessPage locale="zh-HK" formAvailable />);

    expect(screen.getByLabelText("姓名")).toBeTruthy();
    expect(screen.getByRole("button", { name: "送出申請" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "電郵公司管理員" })).toBeNull();
    // The page still explains the process and owns the single h1.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("申請工作空間開通");
  });
});
