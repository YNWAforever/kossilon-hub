// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAnnualReturnCasesForTest } from "@/lib/annual-return-store";
import { resetClientPortalStoreForTest } from "@/lib/client-portal-store";
import { DemoAnnualReturnCaseDetail } from "./demo-case-detail";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/annual-returns">{children}</a>,
}));

vi.mock("@/features/work-items/server-fns", () => ({
  listWorkQueue: vi.fn(async () => []),
}));

function renderDetail(caseId = "ar-delta") {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DemoAnnualReturnCaseDetail caseId={caseId} />
    </QueryClientProvider>,
  );
}

// Demo mode is read-only (docs/adr/0001-demo-mode-is-read-only.md). Every control
// on this screen used to look live: clicking one set a warning string that
// rendered in a different section of the page, so the case appeared to reject the
// edit rather than to have no edit path at all.
describe("demo annual return case detail", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
    resetClientPortalStoreForTest();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the seeded case", () => {
    renderDetail();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Delta Bloom Ventures");
  });

  it("disables every control on the screen", () => {
    const { container } = renderDetail();

    const controls = Array.from(
      container.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select"),
    );

    expect(controls.length).toBeGreaterThan(10);
    expect(controls.filter((control) => !control.disabled).map(describeControl)).toEqual([]);
  });

  it("keeps the note field read-only rather than accepting text it will discard", () => {
    const { container } = renderDetail();

    const textareas = Array.from(container.querySelectorAll("textarea"));

    expect(textareas.length).toBeGreaterThan(0);
    expect(textareas.filter((textarea) => !textarea.readOnly)).toEqual([]);
  });

  it("says once, up front, that the case is read-only", () => {
    renderDetail();

    expect(screen.getByRole("status").textContent).toContain(
      "Read-only demo. Case state is changed in production",
    );
  });

  it("leaves navigation links usable", () => {
    renderDetail();

    expect(screen.getByRole("link", { name: "Back" })).toBeTruthy();
  });
});

function describeControl(control: HTMLButtonElement | HTMLSelectElement): string {
  return `${control.tagName.toLowerCase()}: ${control.getAttribute("aria-label") ?? control.textContent?.trim() ?? ""}`;
}
