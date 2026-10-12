import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { runBunProcess } from "./bun-process";
it("passes receipt paths and argument values with spaces as literal argv", async () => {
  const root = mkdtempSync(join(tmpdir(), "kossilon bun argv "));
  const file = join(root, "read argv.mjs"),
    output = join(root, "receipt file.json");
  try {
    writeFileSync(
      file,
      "import fs from 'node:fs'; fs.writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));",
    );
    const run = await runBunProcess(file, [output, "value with spaces", "literal & value"], {
      timeoutMs: 5000,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual([
      "value with spaces",
      "literal & value",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("terminates the owned blocked child before rejecting its timeout", async () => {
  const root = mkdtempSync(join(tmpdir(), "kossilon bun timeout "));
  const file = join(root, "blocked.mjs"),
    pidFile = join(root, "pid.txt");
  try {
    writeFileSync(
      file,
      "import fs from 'node:fs'; fs.writeFileSync(process.argv[2],String(process.pid)); setInterval(()=>{},1000);",
    );
    await expect(runBunProcess(file, [pidFile], { timeoutMs: 1500 })).rejects.toThrow(
      "Bun process timed out",
    );
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
