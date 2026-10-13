// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Input, Select, Textarea } from "./field";

describe("form fields", () => {
  afterEach(cleanup);

  it("styles an invalid value on the field itself and keeps the message linked", () => {
    render(
      <>
        <label htmlFor="email">電郵</label>
        <Input id="email" aria-invalid aria-describedby="email-error" />
        <p id="email-error">請輸入有效電郵</p>
      </>,
    );

    const field = screen.getByLabelText("電郵");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.className).toContain("aria-invalid:border-destructive");
    expect(screen.getByRole("textbox", { description: "請輸入有效電郵" })).toBe(field);
  });

  it("leaves width to the caller so inline fields stay narrow", () => {
    render(<Input aria-label="日數" className="w-14" />);

    const classes = screen.getByLabelText("日數").className.split(" ");
    expect(classes).toContain("w-14");
    expect(classes).not.toContain("w-full");
  });

  it("renders a native select and a textarea with the same look", () => {
    render(
      <>
        <Select aria-label="狀態" size="sm">
          <option>全部</option>
        </Select>
        <Textarea aria-label="備註" />
      </>,
    );

    expect(screen.getByRole("combobox", { name: "狀態" }).className).toContain("h-8");
    expect(screen.getByRole("textbox", { name: "備註" }).className).toContain("min-h-20");
  });
});
