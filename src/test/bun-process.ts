import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
function bunExecutable() {
  const configured = process.env.BUN_EXECUTABLE ?? "bun";
  if (process.platform === "win32" && configured.toLowerCase().endsWith(".cmd")) {
    const executable = resolve(dirname(configured), "../bun/bin/bun.exe");
    if (!existsSync(executable)) throw Error("BUN_EXECUTABLE must identify the Bun binary.");
    return executable;
  }
  return configured;
}
export function runBunProcess(
  file: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(bunExecutable(), [file, ...args], {
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 25000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      if (timedOut) reject(Error("Bun process timed out; owned child terminated."));
      else resolveResult({ status, stdout, stderr });
    });
  });
}
