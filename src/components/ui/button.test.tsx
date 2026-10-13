// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  afterEach(cleanup);

  it("does not submit a surrounding form unless asked to", () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <Button>取消</Button>
        <Button type="submit">儲存</Button>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders its child element when asChild is set, keeping the button look", () => {
    render(
      <Button asChild variant="primary">
        <a href="/annual-returns">開啟</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "開啟" });
    expect(link.getAttribute("type")).toBeNull();
    expect(link.className).toContain("bg-primary");
  });

  it("lets a caller's classes override the variant's", () => {
    render(<Button className="w-full">全部</Button>);

    expect(screen.getByRole("button", { name: "全部" }).className).toContain("w-full");
  });
});
