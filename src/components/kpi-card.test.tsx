// @vitest-environment jsdom
import { CalendarClock } from "lucide-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KpiCard } from "./kpi-card";

function render(props: Parameters<typeof KpiCard>[0]) {
  return renderToString(createElement(KpiCard, props));
}

describe("KpiCard", () => {
  it("renders the figure when data is available", () => {
    const html = render({ label: "Overdue cases", value: 4, icon: CalendarClock });

    expect(html).toContain('data-testid="kpi-value"');
    expect(html).toMatch(/data-testid="kpi-value"[^>]*>4</);
  });

  it("renders no numeral at all when the figure is unavailable", () => {
    const html = render({
      label: "Overdue cases",
      value: 4,
      icon: CalendarClock,
      unavailable: true,
    });

    const rendered = html.match(/data-testid="kpi-value"[^>]*>([^<]*)</)?.[1] ?? "";

    expect(rendered).not.toMatch(/\d/);
    expect(html).toContain("Unavailable");
  });
});
