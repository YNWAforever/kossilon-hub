import { ArrowRight, Check, Files, Layers3, ShieldCheck } from "lucide-react";
import { marketingCopy, type MarketingLocale } from "./content";

const sections = ["workflow", "features", "pricing", "faq"] as const;

export function MarketingPage({ locale }: { locale: MarketingLocale }) {
  const copy = marketingCopy[locale];
  const home = locale === "en" ? "/en" : "/";
  const nav = sections.map((section, i) => (
    <a key={section} href={`#${section}`}>
      {copy.nav[i]}
    </a>
  ));
  const cta = (
    <a className="comsec-button" href="/login">
      {copy.login} <ArrowRight size={18} aria-hidden="true" />
    </a>
  );

  return (
    <div className="comsec-marketing" lang={locale}>
      <a className="comsec-skip" href="#content">
        {copy.skip}
      </a>
      <header className="comsec-header">
        <div className="comsec-container comsec-nav-row">
          <a className="comsec-brand" href={home}>
            <span aria-hidden="true">
              <Layers3 size={22} />
            </span>
            ComSec OS
          </a>
          <nav className="comsec-desktop-nav" aria-label={copy.navLabel}>
            {nav}
          </nav>
          <div className="comsec-nav-actions">
            <a
              className="comsec-language"
              href={locale === "en" ? "/" : "/en"}
              hrefLang={locale === "en" ? "zh-HK" : "en"}
              lang={locale === "en" ? "zh-HK" : "en"}
            >
              {locale === "en" ? "繁體中文" : "EN"}
            </a>
            <a className="comsec-nav-login" href="/login">
              {locale === "en" ? "Log in" : "登入"}
              <ArrowRight size={15} aria-hidden="true" />
            </a>
            <details className="comsec-mobile-menu">
              <summary>{copy.menu}</summary>
              <nav
                aria-label={copy.navLabel}
                onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
              >
                {nav}
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="content" tabIndex={-1}>
        <section className="comsec-container comsec-hero">
          <div>
            <p className="comsec-eyebrow">
              <span />
              {copy.eyebrow}
            </p>
            <h1>{copy.headline}</h1>
            <p className="comsec-intro">{copy.intro}</p>
            <div className="comsec-hero-actions">
              {cta}
              <a className="comsec-text-link" href="#workflow">
                {copy.secondary}
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
            <p className="comsec-footnote">{copy.footnote}</p>
          </div>
          <figure className="comsec-product">
            <div className="comsec-window-bar">
              <span aria-hidden="true">● ● ●</span>
              <span>{copy.sample.label}</span>
            </div>
            <div className="comsec-product-body">
              <div className="comsec-product-brand">
                <Layers3 size={16} aria-hidden="true" />
                ComSec OS
              </div>
              <h2>{copy.sample.heading}</h2>
              <p className="comsec-product-subtitle">{copy.sample.subheading}</p>
              <div className="comsec-metrics">
                {copy.sample.metrics.map((metric, i) => (
                  <div key={metric}>
                    <span>{metric}</span>
                    <strong>
                      {[3, 2, 1][i]}
                      <span aria-hidden="true">↗</span>
                    </strong>
                  </div>
                ))}
              </div>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{copy.sample.company}</th>
                    <th scope="col">{copy.sample.task}</th>
                    <th scope="col">{copy.sample.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {copy.sample.rows.map(([company, task, status], i) => (
                    <tr key={company}>
                      <th scope="row">{company}</th>
                      <td>{task}</td>
                      <td>
                        <span className={`comsec-badge comsec-badge-${i}`}>{status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="comsec-next">
                <div>
                  <Check size={16} aria-hidden="true" />
                  <strong>{copy.sample.next}</strong>
                </div>
                <p>{copy.sample.nextText}</p>
              </div>
            </div>
            <figcaption>{copy.sample.caption}</figcaption>
          </figure>
        </section>

        <section className="comsec-section comsec-container">
          <div className="comsec-heading">
            <h2>{copy.valuesTitle}</h2>
            <p>{copy.valuesIntro}</p>
          </div>
          <div className="comsec-values">
            {copy.values.map((value, i) => (
              <article key={value.title}>
                <span className="comsec-number">0{i + 1}</span>
                <h3>{value.title}</h3>
                <p>{value.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="comsec-section comsec-tinted">
          <div className="comsec-container">
            <div className="comsec-heading">
              <p className="comsec-eyebrow">{copy.nav[0]}</p>
              <h2>{copy.workflowTitle}</h2>
            </div>
            <ol className="comsec-steps">
              {copy.steps.map((step, i) => (
                <li key={step.title}>
                  <span className="comsec-step">0{i + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="comsec-section comsec-container">
          <div className="comsec-heading">
            <p className="comsec-eyebrow">{copy.nav[1]}</p>
            <h2>{copy.featuresTitle}</h2>
            <p>{copy.featuresIntro}</p>
          </div>
          <div className="comsec-features">
            {copy.features.map((feature, i) => {
              const Icon = [Layers3, Files, ShieldCheck][i % 3];
              return (
                <article key={feature.title}>
                  <Icon size={23} aria-hidden="true" />
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section id="pricing" className="comsec-container comsec-pricing">
          <div>
            <p className="comsec-eyebrow">{copy.nav[2]}</p>
            <h2>{copy.pricingTitle}</h2>
            <p>{copy.pricingText}</p>
          </div>
          <div className="comsec-price">
            <strong>TBC</strong>
            <span>{copy.pricingStatus}</span>
          </div>
        </section>

        <section id="faq" className="comsec-section comsec-container comsec-faq">
          <div className="comsec-heading">
            <p className="comsec-eyebrow">FAQ</p>
            <h2>{copy.faqTitle}</h2>
          </div>
          {copy.faq.map((item, i) => (
            <details key={item.title}>
              <summary>
                <span className="comsec-number">0{i + 1}</span>
                {item.title}
                <span className="comsec-plus" aria-hidden="true">
                  +
                </span>
              </summary>
              <p>{item.text}</p>
            </details>
          ))}
        </section>

        <section className="comsec-closing">
          <div className="comsec-container">
            <div>
              <p className="comsec-eyebrow">ComSec OS</p>
              <h2>{copy.closingTitle}</h2>
              <p>{copy.closingText}</p>
            </div>
            {cta}
          </div>
        </section>
      </main>

      <footer className="comsec-footer">
        <div className="comsec-container">
          <div className="comsec-footer-top">
            <div>
              <a className="comsec-brand" href={home}>
                ComSec OS<span className="comsec-brand-dot">·</span>
              </a>
              <p>{copy.footer}</p>
            </div>
            <nav aria-label={locale === "en" ? "Footer" : "頁尾導覽"}>
              {nav}
              <a href="/login">{copy.login}</a>
            </nav>
          </div>
          <div className="comsec-footer-bottom">
            <p>{copy.legalNote}</p>
            <span>ComSec OS</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
