// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
}));

import { DemoUnavailable } from "./demo-unavailable";

describe("DemoUnavailable", () => {
  afterEach(cleanup);

  it("explains the missing data and points to the demo cases that do exist", () => {
    render(<DemoUnavailable message="系統運作讀取正式資料。" />);

    expect(screen.getByRole("region", { name: "示範模式未提供" })).toBeTruthy();
    expect(screen.getByText("系統運作讀取正式資料。")).toBeTruthy();
    expect(screen.getByRole("link", { name: /瀏覽周年申報案件/ }).getAttribute("href")).toBe(
      "/annual-returns",
    );
  });
});
