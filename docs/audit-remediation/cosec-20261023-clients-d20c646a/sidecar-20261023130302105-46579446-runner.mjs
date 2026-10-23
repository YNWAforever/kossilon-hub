import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { freemem, totalmem } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
assert.equal(process.cwd(), root);
const folder = import.meta.dirname;
const stem = "sidecar-20261023130302105-46579446";
const files = ["src/components/clients/client-form-dialog.tsx", "src/components/clients/client-form-dialog.test.tsx"];
const keep = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.test(key)));
env.CI = "true"; env.NO_COLOR = "1";
env.TEMP = join(root, ".worktrees", stem + "-runtime-temp");
env.TMP = env.TEMP;
mkdirSync(env.TEMP, { recursive: true });
assert.deepEqual(readdirSync(root).filter((f) => f.startsWith(".env") && f !== ".env.example"), [], "No dotenv files may be loaded");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const fingerprints = () => Object.fromEntries(files.map((f) => [f, hash(join(root, f))]));
const save = (suffix, data) => writeFileSync(join(folder, stem + "-" + suffix), data, { flag: "wx" });
const action = process.argv[2];
assert.match(action ?? "", /^[a-z0-9-]+$/);
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
if (action.startsWith("snapshot-")) {
  for (const f of files) copyFileSync(join(root, f), join(folder, stem + "-" + action + "-" + f.split("/").at(-1) + ".snapshot"), constants.COPYFILE_EXCL);
  const result = { action, at: new Date().toISOString(), head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"), status: git("status", "--short"), fingerprints: fingerprints(), free_ram_bytes: freemem(), total_ram_bytes: totalmem(), env_keys: Object.keys(env), dotenv_files: [] };
  save(action + ".json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} else {
  const jsonReport = join(folder, stem + "-" + action + "-vitest.json");
  const args = action.startsWith("lint")
    ? ["node_modules/eslint/bin/eslint.js", ...files, "--max-warnings", "0"]
    : action.startsWith("format")
      ? ["node_modules/prettier/bin/prettier.cjs", "--write", ...files]
      : ["node_modules/vitest/vitest.mjs", "run", "--project", "unit", files[1], "--maxWorkers", "1", "--reporter=verbose", "--reporter=json", "--outputFile.json=" + jsonReport];
  for (const suffix of [action + ".log", action + ".json", action + "-vitest.json"]) assert(!existsSync(join(folder, stem + "-" + suffix)), "Prior evidence exists");
  const before = fingerprints();
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  save(action + ".log", (result.stdout ?? "") + (result.stderr ?? ""));
  const report = existsSync(jsonReport) ? JSON.parse(readFileSync(jsonReport, "utf8")) : null;
  const metadata = { action, started, finished: new Date().toISOString(), cwd: root, command: [process.execPath, ...args], head: git("rev-parse", "HEAD"), exit_code: result.status, signal: result.signal, error: result.error?.message ?? null, env_keys: Object.keys(env), dotenv_files: [], before, after: fingerprints(), counts: report ? { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests } : null };
  save(action + ".json", JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata));
  console.log((result.stdout ?? "") + (result.stderr ?? ""));
  process.exitCode = result.status ?? 1;
}

