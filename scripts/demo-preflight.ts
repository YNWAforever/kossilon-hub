/**
 * Read-only HTTP checks before a customer demo. Rehearse the browser journey separately.
 * Usage: npm run demo:preflight. DEMO_URL and PROD_URL override the hosts to check.
 */
import { DEMO_ORIGIN, PRODUCTION_ORIGIN } from "../src/features/runtime/public-origins.ts";

const DEMO_URL = process.env.DEMO_URL ?? DEMO_ORIGIN;
const PROD_URL = process.env.PROD_URL ?? PRODUCTION_ORIGIN;
const personas = ["Amy Chan", "Ken Wong", "Mei Lam"];
const locales = [
  {
    locale: "zh-HK",
    prefix: "",
    demoLabel: "試用示範",
    intakeLabel: "申請開通",
    picker: "示範身份",
    pickerIntakeLabel: "申請試行開通",
    submit: "送出申請",
  },
  {
    locale: "en",
    prefix: "/en",
    demoLabel: "Try the demo",
    intakeLabel: "Request access",
    picker: "Demo identities",
    pickerIntakeLabel: "Request pilot access",
    submit: "Send request",
  },
];

let passed = 0;
let failed = 0;

function record(name: string, ok: boolean, detail: string): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

function get(origin: string, path: string): Promise<Response> {
  return fetch(new URL(path, origin), {
    redirect: "manual",
    headers: { "cache-control": "no-cache", "user-agent": "comsec-demo-preflight" },
    signal: AbortSignal.timeout(20_000),
  });
}

function hasLink(html: string, href: string, label: string): boolean {
  for (const [, link, text] of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (link === href && text.replace(/<[^>]*>/g, "").trim() === label) return true;
  }
  return false;
}

async function checkPublicJourney({
  locale,
  prefix,
  demoLabel,
  intakeLabel,
  picker,
  pickerIntakeLabel,
  submit,
}: (typeof locales)[number]) {
  const home = prefix || "/";
  const login = `${prefix}/login`;
  const intake = `${prefix}/request-access`;
  const [production, demo, loginPage, intakePage] = await Promise.all([
    get(PROD_URL, home),
    get(DEMO_URL, home),
    get(DEMO_URL, login),
    get(PROD_URL, intake),
  ]);
  const [productionHtml, demoHtml, loginHtml, intakeHtml] = await Promise.all(
    [production, demo, loginPage, intakePage].map((response) => response.text()),
  );
  const productionDemoLink = hasLink(productionHtml, `${DEMO_ORIGIN}${login}`, demoLabel);
  const demoPickerLink = hasLink(demoHtml, login, demoLabel);
  const demoIntakeLink = hasLink(demoHtml, `${PRODUCTION_ORIGIN}${intake}`, intakeLabel);
  const pickerIntakeLink = hasLink(loginHtml, `${PRODUCTION_ORIGIN}${intake}`, pickerIntakeLabel);
  record(
    `${locale} cross-site links`,
    production.ok &&
      demo.ok &&
      productionDemoLink &&
      demoPickerLink &&
      demoIntakeLink &&
      pickerIntakeLink,
    `production home → demo picker=${productionDemoLink}, demo home → picker=${demoPickerLink}, demo home and picker → production form=${demoIntakeLink && pickerIntakeLink}`,
  );
  const hasPicker =
    loginHtml.includes(picker) && personas.every((name) => loginHtml.includes(name));
  record(
    `${locale} picker`,
    loginPage.ok && hasPicker,
    `status=${loginPage.status} personas=${hasPicker}`,
  );
  const hasForm = intakeHtml.includes("<form") && intakeHtml.includes(submit);
  record(
    `${locale} pilot form`,
    intakePage.ok && hasForm,
    `status=${intakePage.status} form=${hasForm}`,
  );
}

async function checkVersions(): Promise<void> {
  const [demoRes, prodRes] = await Promise.all([
    get(DEMO_URL, "/api/version"),
    get(PROD_URL, "/api/version"),
  ]);
  const demo = (await demoRes.json()) as { sha?: string; dataMode?: string };
  const prod = (await prodRes.json()) as { sha?: string; dataMode?: string };
  record(
    "deployments in sync",
    demoRes.ok &&
      prodRes.ok &&
      demo.dataMode === "demo" &&
      prod.dataMode === "production" &&
      Boolean(demo.sha && demo.sha !== "unknown" && demo.sha === prod.sha),
    `demo=${demo.sha ?? "missing"} (${demo.dataMode ?? "missing mode"}) prod=${prod.sha ?? "missing"} (${prod.dataMode ?? "missing mode"})`,
  );
}

async function reportIntegrations(): Promise<void> {
  const [capabilities, login] = await Promise.all([
    get(PROD_URL, "/api/capabilities"),
    get(PROD_URL, "/login"),
  ]);
  const body = (await capabilities.json()) as {
    capabilities?: { id?: string; configured?: boolean }[];
  };
  const disabled = (body.capabilities ?? [])
    .filter((capability) => capability.id && capability.configured !== true)
    .map((capability) => capability.id)
    .join(", ");
  const enforcedCsp = Boolean(login.headers.get("content-security-policy"));
  record(
    "production CSP",
    login.ok && enforcedCsp,
    `status=${login.status} enforced=${enforcedCsp}`,
  );
  record(
    "production capabilities",
    capabilities.ok && Array.isArray(body.capabilities),
    `status=${capabilities.status}`,
  );
  console.log(`INFO unconfigured integrations: ${disabled || "none reported"}`);
}

const checks: [string, () => Promise<void>][] = [
  ...locales.map((entry): [string, () => Promise<void>] => [
    entry.locale,
    () => checkPublicJourney(entry),
  ]),
  ["deployments", checkVersions],
  ["capabilities", reportIntegrations],
];
for (const [name, check] of checks) {
  try {
    await check();
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}
console.log(
  `\ndemo preflight: ${passed}/${passed + failed} HTTP checks passed. Rehearse sign-in and the Crestview journey in a browser.`,
);
if (failed > 0) process.exitCode = 1;
