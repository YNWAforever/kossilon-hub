import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("public request-access entry", () => {
  it("ships server-rendered Chinese and English request-access routes", () => {
    const zh = read("./request-access.tsx");
    const en = read("./en_.request-access.tsx");

    expect(zh).toContain('createFileRoute("/request-access")');
    expect(zh).toContain("ssr: true");
    expect(zh).toContain('pageTitle("申請開通")');
    expect(zh).toContain('locale="zh-HK"');

    expect(en).toContain('createFileRoute("/en_/request-access")');
    expect(en).toContain("ssr: true");
    expect(en).toContain('pageTitle("Request access")');
    expect(en).toContain('locale="en"');
  });

  it("routes the login invitation CTA to the page instead of a raw mailto", () => {
    const login = readFileSync(new URL("../features/auth/login-page.tsx", import.meta.url), "utf8");

    expect(login).toContain('locale === "en" ? "/en/request-access" : "/request-access"');
    expect(login).not.toContain("mailto:willylai");
  });

  it("serves robots.txt and sitemap.xml from the server entry", () => {
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

    expect(server).toContain('pathname === "/robots.txt"');
    expect(server).toContain('pathname === "/sitemap.xml"');
    expect(server).toContain("robotsTxt(origin)");
    expect(server).toContain("sitemapXml(origin)");
  });
});
