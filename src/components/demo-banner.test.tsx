// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DemoBanner } from "./demo-banner";

describe("DemoBanner", () => {
  it("states that the workspace is simulated and read-only", () => {
    const { container } = render(<DemoBanner />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(container.querySelector("[data-demo-banner]")).toBeTruthy();
    expect(screen.getByText("示範模式")).toBeTruthy();
    expect(screen.getByText(/所有資料為模擬，操作不會儲存/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "產品介紹" }).getAttribute("href")).toBe("/");
  });
});
