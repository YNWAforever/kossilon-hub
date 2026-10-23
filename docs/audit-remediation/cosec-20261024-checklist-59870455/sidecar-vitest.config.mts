import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = fileURLToPath(new URL("./", import.meta.url));

// Parent-run, explicitly selected tests only. No checkout .env loading, no
// registry edit, no build/router plugins, one file and one worker at a time.
export default defineConfig({
  root,
  envDir: resolve(evidence, "sidecar-empty-env"),
  cacheDir: resolve(evidence, "sidecar-vitest-cache"),
  resolve: { alias: { "@": resolve(root, "src") } },
  test: {
    include: [
      "src/features/incorporation/checklist-command.test.ts",
      "src/features/incorporation/checklist-recovery.integration.test.ts",
    ],
    environment: "node",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 60_000,
    watch: false,
    reporters: ["verbose"],
  },
});
