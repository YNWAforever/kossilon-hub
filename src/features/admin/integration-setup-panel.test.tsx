// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  loaded: true,
  security: { cspMode: "enforce", authMethods: { password: true, magicLink: true, google: true } },
  rows: [
    { id: "firm", configured: false, missing: ["FIRM_ID"] },
    { id: "email", configured: false, missing: ["EMAIL_FROM|RESEND_FROM"] },
    { id: "whatsapp", configured: false, missing: ["WOZTELL_ACCESS_TOKEN"] },
    { id: "database", configured: true, missing: [] },
  ],
}));

vi.mock("@/features/operations/use-runtime-capabilities", () => ({
  useRuntimeCapabilities: () => ({ ...state, refresh }),
}));

import { IntegrationSetupPanel } from "./integration-setup-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IntegrationSetupPanel", () => {
  it("shows missing binding names and the owner action without storing values", () => {
    render(<IntegrationSetupPanel />);

    expect(screen.getByText("整合設定")).toBeTruthy();
    expect(screen.getAllByText(/缺少：/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("FIRM_ID").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EMAIL_FROM|RESEND_FROM").length).toBeGreaterThan(0);
    expect(screen.getByText(/Vercel Environment Variables/)).toBeTruthy();
    // Sensitive names are named, but no value input exists on this panel.
    expect(screen.getAllByText(/WOZTELL_ACCESS_TOKEN/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox")).toBeNull();
    // Configured rows say so.
    expect(screen.getByText("已配置")).toBeTruthy();
    expect(screen.getByText("enforce")).toBeTruthy();
    expect(screen.getByText(/密碼 · 登入連結 · Google/)).toBeTruthy();
  });

  it("refreshes the capability report on demand", () => {
    render(<IntegrationSetupPanel />);

    fireEvent.click(screen.getByRole("button", { name: /重新整理/ }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
