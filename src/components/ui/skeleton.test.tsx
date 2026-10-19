// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoadingRows } from "./skeleton";

describe("LoadingRows", () => {
  afterEach(cleanup);

  it("announces what is loading while showing placeholder rows", () => {
    const { container } = render(<LoadingRows label="正在載入跟進…" rows={4} />);

    expect(screen.getByRole("status").textContent).toBe("正在載入跟進…");
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(12);
  });

  it("keeps the placeholders out of the accessibility tree and still under reduced motion", () => {
    const { container } = render(<LoadingRows label="載入中" rows={1} />);

    for (const block of container.querySelectorAll(".animate-pulse")) {
      expect(block.getAttribute("aria-hidden")).toBe("true");
      expect(block.className).toContain("motion-reduce:animate-none");
    }
  });
});
