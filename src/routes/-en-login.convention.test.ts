import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("English login entry", () => {
  it("ships a server-rendered English login route outside the marketing layout", () => {
    const english = route("./en_.login.tsx");

    // `en_.login.tsx` opts out of the `/en` marketing layout: nesting the login
    // page under it rendered the marketing page for /en/login.
    expect(english).toContain('createFileRoute("/en_/login")');
    expect(english).toContain("ssr: true");
    expect(english).toContain('pageTitle("Sign in")');
    expect(english).toContain('locale="en"');
  });

  it("keeps the marketing login links inside the active locale", () => {
    const page = readFileSync(new URL("../features/marketing/page.tsx", import.meta.url), "utf8");

    expect(page).toContain('const loginHref = locale === "en" ? "/en/login" : "/login"');
    expect(page).not.toContain('href="/login"');
  });
});
