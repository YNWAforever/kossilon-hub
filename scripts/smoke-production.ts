import {
  DEMO_ORIGIN,
  PRODUCTION_ORIGIN,
  demoChecks,
  formatSmokeResults,
  productionChecks,
  runSmokeChecks,
} from "../src/features/operations/post-deploy-smoke.ts";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match?.slice(prefix.length);
}

// Deploy-triggered runs verify the deployment; they do not own the scheduler
// alarm. A pre-existing dead cron must not make every deploy look broken — the
// scheduled monitor is the run that carries /api/health.
const includeHealth = !process.argv.includes("--skip-health");

const productionOrigin =
  argument("origin") ?? process.env.SMOKE_PRODUCTION_ORIGIN ?? PRODUCTION_ORIGIN;
const demoOrigin = argument("demo-origin") ?? process.env.SMOKE_DEMO_ORIGIN ?? DEMO_ORIGIN;
const expectedSha = argument("expect-sha") ?? process.env.EXPECTED_SHA ?? "";

const checks = [
  ...productionChecks(productionOrigin, expectedSha || undefined),
  ...demoChecks(demoOrigin),
].filter((check) => includeHealth || check.name !== "health");

const { ok, results } = await runSmokeChecks(fetch, checks);
const report = formatSmokeResults(results);

console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Post-deploy smoke",
      "",
      `Production: ${productionOrigin}`,
      `Demo: ${demoOrigin}`,
      `Expected SHA: ${expectedSha || "-"}`,
      `Health/cron alarm: ${includeHealth ? "included" : "skipped (deploy verification mode)"}`,
      "",
      "```",
      report,
      "```",
      "",
    ].join("\n"),
  );
}

if (!ok) {
  const webhook = process.env.SMOKE_ALERT_WEBHOOK;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `Post-deploy smoke FAILED\n${report}`,
          content: `**Post-deploy smoke FAILED**\n\`\`\`\n${report}\n\`\`\``,
        }),
      });
    } catch {
      // The failed check is what matters; a broken alert wire must not change
      // the exit status. The job log and failed workflow still alert.
    }
  }
  process.exit(1);
}

console.log("post-deploy smoke: all checks passed");
