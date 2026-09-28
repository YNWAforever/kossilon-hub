// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operationalActionFor } from "@/features/runtime/operational-copy";
import { DailyWorkRow } from "@/features/annual-return/components/daily-work-row";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    hash,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: { id: string };
    search?: { caseId: string };
    hash?: string;
    [key: string]: unknown;
  }) => (
    <a
      href={
        to.replace("$id", params?.id ?? "") +
        (search ? `?caseId=${search.caseId}` : "") +
        (hash ? `#${hash}` : "")
      }
      {...rest}
    >
      {children}
    </a>
  ),
}));

afterEach(cleanup);
const row = {
  caseId: "11111111-1111-4111-8111-111111111111",
  companyName: "Harbour Sample Limited",
  returnYear: 2026,
  filingDueDate: "2026-10-31",
  daysRemaining: 20,
  ownerName: "Ada Chan",
  blocker: "已簽署周年申報表",
  documentId: "22222222-2222-4222-8222-222222222222",
};

describe("T26 daily work audit UX", () => {
  it("t26_scenario_1: primary action stays in the row at 1440, 1280, 768 and 390 px", () => {
    for (const width of [1440, 1280, 768, 390]) {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      const view = render(<DailyWorkRow row={row} viewKey="chaseToday" />);
      expect(screen.getByRole("link", { name: /草擬追件.*Harbour Sample Limited/ })).toBeTruthy();
      expect(view.container.querySelector("[data-mobile-action]")).toBeTruthy();
      view.unmount();
    }
  });

  it("t26_scenario_2: reminders and new documents deep-link to their exact work context", () => {
    expect(operationalActionFor("chaseToday", row)).toMatchObject({
      kind: "reminder",
      href: `/annual-returns/${row.caseId}#reminders`,
    });
    expect(operationalActionFor("newlyReceived", row)).toMatchObject({
      kind: "document-review",
      href: `/documents?caseId=${row.caseId}#document-${row.documentId}`,
    });
    expect(operationalActionFor("newlyReceived", { ...row, documentId: null })).toMatchObject({
      kind: "document-review",
      disabledReason: expect.any(String),
    });
    render(<DailyWorkRow row={row} viewKey="newlyReceived" />);
    expect(
      screen.getByRole("link", { name: /覆核新文件.*Harbour Sample Limited/ }).getAttribute("href"),
    ).toBe(`/documents?caseId=${row.caseId}#document-${row.documentId}`);
  });

  it("t26_scenario_3: repeated action names identify each company and unavailable work explains why", () => {
    const second = {
      ...row,
      caseId: "33333333-3333-4333-8333-333333333333",
      companyName: "Island Sample Limited",
    };
    render(
      <>
        <DailyWorkRow row={row} viewKey="chaseToday" />
        <DailyWorkRow row={second} viewKey="chaseToday" />
      </>,
    );
    expect(screen.getByRole("link", { name: /草擬追件.*Harbour Sample Limited/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /草擬追件.*Island Sample Limited/ })).toBeTruthy();
    const blocked = operationalActionFor(
      "returnsAndExceptions",
      row,
      "內部伺服器回件尚未接通；請由主管人手核對。",
    );
    expect(blocked.href).toBeUndefined();
    expect(blocked.disabledReason).toContain("主管");
  });
});
