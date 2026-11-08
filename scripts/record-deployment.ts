import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DEPLOYMENT_RECORD_NOTE,
  DEPLOYMENT_RECORD_SCHEMA_VERSION,
  mergeDeploymentRecords,
  toRecordedDeployment,
  type DeploymentRecordFile,
  type VercelDeploymentInput,
} from "../src/features/operations/deployment-record.ts";

const TEAM_ID = process.env.VERCEL_TEAM_ID ?? "team_qvzlsFmfCsLkgItSypqHjw3z";
const PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? "prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC";
const TARGET = process.env.VERCEL_RECORD_PATH ?? "docs/releases/deployments.json";

function token(): string {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const authFile = process.env.VERCEL_AUTH_FILE;
  if (authFile) {
    const parsed = JSON.parse(readFileSync(authFile, "utf8")) as {
      token?: string;
      accessToken?: string;
    };
    const value = parsed.token ?? parsed.accessToken;
    if (value) return value;
  }
  throw new Error("VERCEL_TOKEN or VERCEL_AUTH_FILE is required to record deployments.");
}

const response = await fetch(
  `https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&target=production&limit=50&teamId=${TEAM_ID}`,
  { headers: { Authorization: `Bearer ${token()}` } },
);
if (!response.ok) {
  throw new Error(`Vercel deployments request failed: ${response.status}`);
}
const payload = (await response.json()) as { deployments?: VercelDeploymentInput[] };
const fetched = (payload.deployments ?? []).map(toRecordedDeployment);

const path = resolve(process.cwd(), TARGET);
const existing: DeploymentRecordFile = existsSync(path)
  ? (JSON.parse(readFileSync(path, "utf8")) as DeploymentRecordFile)
  : {
      schemaVersion: DEPLOYMENT_RECORD_SCHEMA_VERSION,
      note: DEPLOYMENT_RECORD_NOTE,
      deployments: [],
    };

const next: DeploymentRecordFile = {
  schemaVersion: DEPLOYMENT_RECORD_SCHEMA_VERSION,
  note: DEPLOYMENT_RECORD_NOTE,
  deployments: mergeDeploymentRecords(existing.deployments, fetched),
};

mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
console.log(
  `recorded ${next.deployments.length} production deployments in ${TARGET} (latest ${next.deployments[0]?.deploymentId ?? "none"})`,
);
