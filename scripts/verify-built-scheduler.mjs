import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = process.argv[2];
if (target !== "vercel" && target !== "cloudflare") {
  throw new Error("Expected deploy target: vercel or cloudflare.");
}

async function text(path) {
  return readFile(resolve(path), "utf8");
}

async function json(path) {
  return JSON.parse(await text(path));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

if (target === "vercel") {
  const deployment = await json("vercel.json");
  const cron = deployment.crons?.find((entry) => entry.path === "/api/cron/maintenance");
  requireCondition(
    cron?.schedule === "*/5 * * * *",
    "Vercel maintenance cron schedule is missing.",
  );

  const metadata = await json(".vercel/output/nitro.json");
  requireCondition(metadata.preset === "vercel", "Built artifact is not the Vercel preset.");
  requireCondition(
    metadata.serverEntry === "functions/__server.func/index.mjs",
    "Vercel server entry is unexpected.",
  );
  const routes = await json(".vercel/output/config.json");
  requireCondition(
    routes.routes?.some((route) => route.src === "/(.*)" && route.dest === "/__server"),
    "Vercel catch-all route does not reach the server function.",
  );
  const server = await text(".vercel/output/" + metadata.serverEntry);
  requireCondition(
    server.includes("_ssr/ssr.mjs"),
    "Vercel server entry does not load the SSR routes.",
  );
  const routesBundle = await text(".vercel/output/functions/__server.func/_ssr/ssr.mjs");
  requireCondition(
    routesBundle.includes("/api/cron/maintenance"),
    "Maintenance HTTP route is missing from the built Vercel server.",
  );
  console.log("PASS built Vercel maintenance cron route and schedule");
} else {
  const metadata = await json(".output/nitro.json");
  requireCondition(
    String(metadata.preset).startsWith("cloudflare"),
    "Built artifact is not a Cloudflare preset.",
  );
  const worker = await text(".output/server/index.mjs");
  requireCondition(
    worker.includes('hooks.hook("cloudflare:scheduled"'),
    "Cloudflare scheduled hook is missing from the built Worker.",
  );
  const wrangler = await text("wrangler.template.jsonc");
  requireCondition(
    wrangler.includes('"crons": ["*/5 * * * *"]'),
    "Cloudflare five-minute trigger is missing.",
  );
  console.log("PASS built Cloudflare scheduled hook and trigger");
}
