import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("English login entry", () => {
  it("ships a server-rendered English login route with its own title", () => {
    const english = route("./en.login.tsx");

    expect(english).toContain('createFileRoute("/en/login")');
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
