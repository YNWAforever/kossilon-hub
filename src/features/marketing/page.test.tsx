// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarketingPage } from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it.each([
  { locale: "zh-HK", prefix: "", tryDemo: "試用示範", requestAccess: "申請開通" },
  { locale: "en", prefix: "/en", tryDemo: "Try the demo", requestAccess: "Request access" },
] as const)(
  "links production marketing to the $locale demo picker",
  ({ locale, prefix, tryDemo, requestAccess }) => {
    vi.stubEnv("VITE_ENABLE_DEMO_AUTH", "false");
    vi.stubEnv("VITE_DEMO_FIXTURE_MODE", "false");
    render(<MarketingPage locale={locale} />);

    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: tryDemo }).getAttribute("href")).toBe(
      `https://kossilon-hub-demo.vercel.app${prefix}/login`,
    );
    expect(main.getByRole("link", { name: requestAccess }).getAttribute("href")).toBe(
      `${prefix}/request-access`,
    );
  },
);
