import marketingCss from "./marketing.css?url";
import { marketingCopy, type MarketingLocale } from "./content";

/** The public, indexable pages. Authenticated screens are deliberately absent. */
const PUBLIC_PATHS = ["/", "/en", "/request-access", "/en/request-access"] as const;

export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /login",
    "Disallow: /en/login",
    "Disallow: /demo",
    "Disallow: /api/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(origin: string): string {
  const urls = PUBLIC_PATHS.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function marketingHead(locale: MarketingLocale) {
  const copy = marketingCopy[locale];
  const title = `ComSec OS — ${locale === "en" ? "Clarity for company secretarial teams" : "讓公司秘書工作更有條理"}`;
  return {
    meta: [
      { title },
      { name: "description", content: copy.metaDescription },
      { property: "og:title", content: title },
      { property: "og:description", content: copy.metaDescription },
      { property: "og:locale", content: locale === "en" ? "en_HK" : "zh_HK" },
    ],
    links: [
      { rel: "stylesheet", href: marketingCss },
      { rel: "alternate", hrefLang: "zh-HK", href: "/" },
      { rel: "alternate", hrefLang: "en", href: "/en" },
    ],
  };
}
