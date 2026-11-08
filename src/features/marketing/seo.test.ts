import { describe, expect, it } from "vitest";

import { robotsTxt, sitemapXml } from "./seo";

const ORIGIN = "https://app.example.test";

describe("public SEO documents", () => {
  it("lets robots crawl the public pages and blocks authenticated surfaces", () => {
    const robots = robotsTxt(ORIGIN);

    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Disallow: /login");
    expect(robots).toContain("Disallow: /en/login");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it("lists exactly the public pages in the sitemap", () => {
    const xml = sitemapXml(ORIGIN);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    for (const path of ["/", "/en", "/request-access", "/en/request-access"]) {
      expect(xml).toContain(`<loc>${ORIGIN}${path}</loc>`);
    }
    expect(xml).not.toContain("/login");
    expect(xml.match(/<url>/g)).toHaveLength(4);
  });
});
