// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageHeader } from "./page-header";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<PageHeader title="Payments" />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Payments");
  });

  it("renders the optional eyebrow, subtitle, and actions", () => {
    render(
      <PageHeader
        eyebrow="Finance"
        title="Payments"
        subtitle="12 invoices unpaid"
        actions={<button type="button">Export</button>}
      />,
    );

    expect(screen.getByText("Finance")).toBeDefined();
    expect(screen.getByText("12 invoices unpaid")).toBeDefined();
    expect(screen.getByRole("button", { name: "Export" })).toBeDefined();
  });

  it("renders nothing but the heading when only a title is given", () => {
    const { container } = render(<PageHeader title="Tasks" />);

    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
