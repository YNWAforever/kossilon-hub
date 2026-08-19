import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

// Placeholder routes and one placeholder id for the one dynamic route
// (annual-returns.$id.tsx) — this gate checks that the module graph loads
// without an import-protection violation, not that the id resolves to real
// data, so any well-formed UUID is fine.
const ROUTE_PATHS = [
  "/",
  "/admin",
  "/annual-returns",
  "/annual-returns/11111111-1111-4111-8111-111111111111",
  "/documents",
  "/login",
  "/payments",
  "/portal",
  "/settings",
  "/whatsapp",
  "/whatsapp/automation",
  "/work-queue",
] as const;

const READY_TIMEOUT_MS = 30_000;
const ROUTE_REQUEST_TIMEOUT_MS = 15_000;
const IMPORT_PROTECTION_MARKER = "[import-protection]";

export function findImportProtectionViolation(output: string): string | null {
  const index = output.indexOf(IMPORT_PROTECTION_MARKER);
  if (index === -1) return null;
  return output.slice(index, index + 400);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not determine a free port."));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function waitForReady(getOutput: () => string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (getOutput().includes("ready in")) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(
          new Error(`Dev server did not report ready within ${timeoutMs}ms.\n${getOutput()}`),
        );
      }
    }, 200);
  });
}

async function requestRoute(
  baseUrl: string,
  path: string,
): Promise<{ path: string; ok: boolean; error?: string }> {
  try {
    // Any HTTP status (including a redirect to /login for an unauthenticated
    // route) proves the route module loaded and rendered without the import
    // graph itself throwing — that is the only thing this gate checks.
    const response = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(ROUTE_REQUEST_TIMEOUT_MS),
    });
    await response.text();
    return { path, ok: true };
  } catch (error) {
    return { path, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const port = await findFreePort();
  let output = "";
  const child: ChildProcessWithoutNullStreams = spawn(
    "npm",
    ["run", "dev", "--", "--port", String(port)],
    {
      env: { ...process.env, VITE_ENABLE_DEMO_AUTH: "true" },
      shell: true,
      // Detaching on POSIX lets teardown kill the whole process group — `npm
      // run dev` runs through a shell that forks vite as a grandchild, and
      // killing only the shell's own pid leaves that grandchild running.
      detached: process.platform !== "win32",
    },
  );
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  function killChild(): void {
    if (!child.pid) {
      child.kill();
      return;
    }
    if (process.platform === "win32") {
      // npm run dev spawns through cmd.exe (shell: true), which forks a node
      // process running vite, which itself may fork further workers —
      // child.kill() only signals cmd.exe and leaves those grandchildren
      // running, which keeps their piped stdout/stderr open and the event
      // loop alive forever. taskkill's /t kills the whole process tree.
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }

  try {
    await waitForReady(() => output, READY_TIMEOUT_MS);

    const baseUrl = `http://localhost:${port}`;
    const results = [];
    for (const path of ROUTE_PATHS) {
      results.push(await requestRoute(baseUrl, path));
    }

    for (const result of results) {
      console.log(`${result.ok ? "PASS" : "FAIL"} request ${result.path}${result.error ? `: ${result.error}` : ""}`);
    }

    const violation = findImportProtectionViolation(output);
    if (violation) {
      console.log(`FAIL import-protection violation detected in dev server output:\n${violation}`);
    } else {
      console.log("PASS no import-protection violation in dev server output");
    }

    const failedRequests = results.filter((result) => !result.ok).length;
    if (violation || failedRequests > 0) {
      process.exitCode = 1;
    }
  } finally {
    killChild();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
