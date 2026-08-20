// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DemoClientNotice } from "./demo-client-notice";

describe("DemoClientNotice", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a register-specific message and a PageHeader h1", () => {
    render(<DemoClientNotice variant="register" />);

    expect(screen.getByRole("heading", { level: 1, name: "Clients" })).toBeTruthy();
    expect(screen.getByText(/no demo fixtures/i)).toBeTruthy();
  });

  it("renders a detail-specific message", () => {
    render(<DemoClientNotice variant="detail" />);

    expect(screen.getByRole("heading", { level: 1, name: "Client" })).toBeTruthy();
    expect(screen.getByText(/no demo fixtures/i)).toBeTruthy();
  });
});
