// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecordUnavailable } from "./record-unavailable";

describe("RecordUnavailable", () => {
  afterEach(cleanup);

  it("tells the user a missing record is gone and offers only the way back", () => {
    render(<RecordUnavailable title="找不到客戶" back={<a href="/clients">返回客戶</a>} />);

    expect(screen.getByRole("heading", { level: 1, name: "找不到客戶" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回客戶" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重試" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces a load failure and lets the user retry it", () => {
    const onRetry = vi.fn();
    render(
      <RecordUnavailable
        title="客戶資料無法載入"
        message="客戶資料暫時無法載入，請稍後再試。"
        back={<a href="/clients">返回客戶</a>}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe("客戶資料暫時無法載入，請稍後再試。");
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
