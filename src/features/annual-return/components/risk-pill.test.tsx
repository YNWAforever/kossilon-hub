// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RiskPill } from "./risk-pill";

describe("RiskPill", () => {
  afterEach(cleanup);

  it("labels the risk in Chinese with the shared status tones", () => {
    render(<RiskPill risk="overdue" />);

    const pill = screen.getByText("已逾期");
    expect(pill.className).toContain("text-status-red-text");
    expect(pill.className).not.toMatch(/\bbg-red-100\b/);
  });
});
