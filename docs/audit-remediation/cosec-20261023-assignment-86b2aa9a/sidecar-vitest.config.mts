import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scratch = resolve(root, ".worktrees/sidecar-assignment-86b2aa9a");
export default defineConfig({
  root,
  // Do not load checkout .env files or create a node_modules cache.
  envDir: scratch,
  cacheDir: resolve(scratch, "vite-cache"),
  plugins: [react()],
  resolve: { alias: { "@": resolve(root, "src") } },
  test: {
    include: ["src/routes/-work-queue.interaction.test.tsx"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 10000,
    watch: false,
    reporters: ["verbose"],
  },
});
