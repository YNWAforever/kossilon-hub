import marketingCss from "./marketing.css?url";
import { marketingCopy, type MarketingLocale } from "./content";

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
