export type SmokeCheck = {
  name: string;
  url: string;
  expectStatus: number;
  includes?: readonly string[];
  excludes?: readonly string[];
  /** Response header names that must be present (values are not asserted). */
  headerPresent?: readonly string[];
  /** Header groups where at least one member must be present. */
  headerAnyOf?: readonly (readonly string[])[];
};

export type SmokeResult = {
  name: string;
  url: string;
  status: number | null;
  ok: boolean;
  detail: string;
};

export const PRODUCTION_ORIGIN = "https://kossilon-hub.vercel.app";
export const DEMO_ORIGIN = "https://kossilon-hub-demo.vercel.app";

export function productionChecks(origin = PRODUCTION_ORIGIN, expectedSha?: string): SmokeCheck[] {
  const checks: SmokeCheck[] = [
    {
      name: "version",
      url: `${origin}/api/version`,
      expectStatus: 200,
      includes: ['"environment":"production"', '"dataMode":"production"'],
    },
    {
      name: "login",
      url: `${origin}/login`,
      expectStatus: 200,
      includes: ["登入工作空間"],
      headerPresent: ["x-content-type-options", "referrer-policy"],
      // The deployment may run CSP report-only or enforced; either is honest.
      headerAnyOf: [["content-security-policy", "content-security-policy-report-only"]],
    },
    {
      name: "login-en",
      url: `${origin}/en/login`,
      expectStatus: 200,
      includes: ["Sign in to your workspace"],
    },
    {
      name: "request-access",
      url: `${origin}/request-access`,
      expectStatus: 200,
      includes: ["申請工作空間開通"],
    },
    {
      name: "request-access-en",
      url: `${origin}/en/request-access`,
      expectStatus: 200,
      includes: ["Request workspace access"],
    },
    {
      name: "robots",
      url: `${origin}/robots.txt`,
      expectStatus: 200,
      includes: ["Disallow: /demo", "Sitemap:"],
    },
    {
      name: "sitemap",
      url: `${origin}/sitemap.xml`,
      expectStatus: 200,
      includes: ["<urlset", "/request-access"],
    },
    {
      name: "manifest",
      url: `${origin}/manifest.webmanifest`,
      expectStatus: 200,
      includes: ['"name": "ComSec OS"', '"start_url": "/login"', "/icons/icon-maskable-512.png"],
    },
    {
      name: "auth-proxy",
      url: `${origin}/api/auth/ok`,
      expectStatus: 200,
      includes: ['"ok":true'],
    },
    {
      name: "capabilities",
      url: `${origin}/api/capabilities`,
      expectStatus: 200,
      includes: ['"capabilities"', '"firm"', '"email"'],
    },
    {
      name: "health",
      url: `${origin}/api/health`,
      expectStatus: 200,
      includes: ['"ok":true', '"scheduler"', '"running":true'],
    },
  ];

  if (expectedSha?.trim()) {
    checks[0] = {
      ...checks[0],
      includes: [...(checks[0].includes ?? []), `"sha":"${expectedSha.trim()}"`],
    };
  }
  return checks;
}

export function demoChecks(origin = DEMO_ORIGIN): SmokeCheck[] {
  return [
    {
      name: "demo-version",
      url: `${origin}/api/version`,
      expectStatus: 200,
      includes: ['"dataMode":"demo"'],
    },
    {
      name: "demo-login",
      url: `${origin}/login`,
      expectStatus: 200,
      includes: ["示範身份", "選擇任何身份即可進入示範"],
    },
    {
      name: "demo-entry",
      // The fixture build redirects /demo to /login; following it must land on
      // the identity picker, not an empty shell.
      url: `${origin}/demo`,
      expectStatus: 200,
      includes: ["示範身份"],
    },
    {
      name: "demo-marketing",
      url: `${origin}/`,
      expectStatus: 200,
      includes: ["試用示範"],
    },
    {
      name: "demo-robots",
      url: `${origin}/robots.txt`,
      expectStatus: 200,
      includes: ["Disallow: /demo"],
    },
  ];
}

export async function runSmokeChecks(
  fetcher: typeof fetch,
  checks: readonly SmokeCheck[],
): Promise<{ ok: boolean; results: SmokeResult[] }> {
  const results: SmokeResult[] = [];

  for (const check of checks) {
    try {
      const response = await fetcher(check.url, {
        redirect: "follow",
        headers: { "cache-control": "no-cache" },
      });
      const body = await response.text();
      const failures: string[] = [];
      if (response.status !== check.expectStatus) {
        failures.push(`expected ${check.expectStatus}, got ${response.status}`);
      }
      for (const needle of check.includes ?? []) {
        if (!body.includes(needle)) failures.push(`missing ${JSON.stringify(needle)}`);
      }
      for (const needle of check.excludes ?? []) {
        if (body.includes(needle)) failures.push(`unexpected ${JSON.stringify(needle)}`);
      }
      for (const header of check.headerPresent ?? []) {
        if (!response.headers.has(header)) failures.push(`missing header ${header}`);
      }
      for (const group of check.headerAnyOf ?? []) {
        if (!group.some((header) => response.headers.has(header)))
          failures.push(`missing any of ${group.join("|")}`);
      }
      results.push({
        name: check.name,
        url: check.url,
        status: response.status,
        ok: failures.length === 0,
        detail: failures.join("; ") || "ok",
      });
    } catch (error) {
      results.push({
        name: check.name,
        url: check.url,
        status: null,
        ok: false,
        detail: error instanceof Error ? error.message : "request failed",
      });
    }
  }

  return { ok: results.every((result) => result.ok), results };
}

export function formatSmokeResults(results: readonly SmokeResult[]): string {
  return results
    .map(
      (result) =>
        `${result.ok ? "PASS" : "FAIL"} ${result.name} ${result.status ?? "-"} ${result.detail} (${result.url})`,
    )
    .join("\n");
}
