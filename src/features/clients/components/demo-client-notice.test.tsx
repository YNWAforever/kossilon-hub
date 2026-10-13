// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/annual-returns">{children}</a>,
}));

import { DemoClientNotice } from "./demo-client-notice";

describe("DemoClientNotice", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a register-specific message and a PageHeader h1", () => {
    render(<DemoClientNotice variant="register" />);

    expect(screen.getByRole("heading", { level: 1, name: "客戶" })).toBeTruthy();
    expect(screen.getByText(/並無示範資料/)).toBeTruthy();
  });

  it("renders a detail-specific message", () => {
    render(<DemoClientNotice variant="detail" />);

    expect(screen.getByRole("heading", { level: 1, name: "客戶資料" })).toBeTruthy();
    expect(screen.getByText(/並無示範資料/)).toBeTruthy();
  });
});
