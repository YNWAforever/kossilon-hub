import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../server-fns", () => ({
  listAnnualReturnCaseParties: () => Promise.reject(new Error("private SQL details")),
  confirmAnnualReturnCaseParty: vi.fn(),
}));

import { CaseParties } from "./case-parties";

const CASE_ID = "40000000-0000-0000-0000-000000000002";

describe("T02 parties read state", () => {
  it("t02_scenario_3 never claims no parties or 0/0 confirmed after a query failure", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    await client.prefetchQuery({
      queryKey: ["annual-return", "case-parties", CASE_ID],
      queryFn: () => Promise.reject(new Error("private SQL details")),
    });
    const html = renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(CaseParties, { caseId: CASE_ID, locked: false }),
      ),
    );
    expect(html).toContain("無法載入相關人士名單");
    expect(html).toContain("重試");
    expect(html).not.toContain("公司董事名冊沒有在任人士");
    expect(html).not.toContain("0/0 已確認");
    expect(html).not.toContain("private SQL details");
  });
});
