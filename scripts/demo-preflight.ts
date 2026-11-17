/**
 * Read-only pre-flight for a customer demo.
 *
 * Checks the public demo deployment, the production booking form and the
 * invite-only signup guard. No credentials, no writes, no customer data.
 *
 * Usage: npm run demo:preflight
 * Override hosts with DEMO_URL / PROD_URL when needed.
 */

const DEMO_URL = process.env.DEMO_URL ?? "https://kossilon-hub-demo.vercel.app";
const PROD_URL = process.env.PROD_URL ?? "https://kossilon-hub.vercel.app";

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

async function get(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "manual",
    headers: {
      "cache-control": "no-cache",
      "user-agent": "comsec-demo-preflight",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

async function checkDemoLogin(): Promise<void> {
  const res = await get(`${DEMO_URL}/login`);
  const body = await res.text();
  const personas = ["Amy Chan", "Ken Wong", "Mei Lam"].filter((name) => body.includes(name));
  const hasPicker = body.includes("示範身份");
  record(
    "demo-login",
    res.status === 200 && personas.length === 3 && hasPicker,
    `status=${res.status} personas=${personas.length}/3 picker=${hasPicker}`,
  );
}

async function checkDemoMarketing(): Promise<void> {
  const res = await get(`${DEMO_URL}/`);
  const body = await res.text();
  record(
    "demo-marketing",
    res.status === 200 && body.includes("試用示範"),
    `status=${res.status} try-demo-link=${body.includes("試用示範")}`,
  );
}

async function checkVersions(): Promise<void> {
  const [demoRes, prodRes] = await Promise.all([
    get(`${DEMO_URL}/api/version`),
    get(`${PROD_URL}/api/version`),
  ]);
  const demo = (await demoRes.json()) as { sha?: string };
  const prod = (await prodRes.json()) as { sha?: string };
  const demoOk = demoRes.status === 200 && typeof demo.sha === "string" && demo.sha.length > 0;
  record("demo-version", demoOk, `status=${demoRes.status} sha=${demo.sha ?? "missing"}`);
  record(
    "deployments-in-sync",
    demoOk && prodRes.status === 200 && demo.sha === prod.sha,
    `demo=${demo.sha ?? "missing"} prod=${prod.sha ?? "missing"}`,
  );
}

async function checkBookingForm(): Promise<void> {
  const res = await get(`${PROD_URL}/request-access`);
  const body = await res.text();
  const hasForm = body.includes("申請工作空間開通") && body.includes("送出申請");
  record("booking-form", res.status === 200 && hasForm, `status=${res.status} form=${hasForm}`);
}

async function checkSignupGuard(): Promise<void> {
  const res = await get(`${PROD_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "demo-preflight@example.invalid",
      password: "not-a-real-password",
      name: "preflight",
    }),
  });
  const body = await res.text();
  let code = "";
  try {
    code = (JSON.parse(body) as { code?: string }).code ?? "";
  } catch {
    code = "";
  }
  record(
    "invite-only-signup",
    res.status === 403 && code === "SIGNUP_DISABLED",
    `status=${res.status} code=${code || "none"}`,
  );
}

async function reportIntegrations(): Promise<void> {
  const res = await get(`${PROD_URL}/api/capabilities`);
  const body = (await res.json()) as {
    capabilities?: { id?: string; configured?: boolean }[];
    security?: { cspMode?: string };
  };
  const disabled = (body.capabilities ?? [])
    .filter((capability) => capability.id && capability.configured !== true)
    .map((capability) => capability.id)
    .join(", ");
  const cspMode = body.security?.cspMode ?? "missing";
  record(
    "security-posture",
    res.status === 200 && cspMode === "enforce",
    `status=${res.status} csp=${cspMode}`,
  );
  console.log(`INFO unconfigured integrations (do not present as live): ${disabled || "none"}`);
}

async function main(): Promise<void> {
  const checksToRun = [
    checkDemoLogin,
    checkDemoMarketing,
    checkVersions,
    checkBookingForm,
    checkSignupGuard,
    reportIntegrations,
  ];
  for (const check of checksToRun) {
    try {
      await check();
    } catch (error) {
      record(check.name, false, error instanceof Error ? error.message : String(error));
    }
  }
  const failed = checks.filter((check) => !check.ok);
  console.log(
    `\ndemo preflight: ${checks.length - failed.length}/${checks.length} passed — ${failed.length === 0 ? "READY" : "NOT READY"}`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

await main();
