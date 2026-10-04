import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { expect, it, vi } from "vitest";

import projectConfig from "../../vite.config";

async function removeOwnedFixture(ownerRoot: string) {
  if (
    !path.resolve(ownerRoot).startsWith(`${path.resolve(tmpdir())}${path.sep}kossilon-dev-watch-`)
  ) {
    throw new Error("Refusing cleanup outside the owned watcher fixture");
  }
  await rm(ownerRoot, { recursive: true, force: true });
}

it.each(["plain", "nested", "glob characters"])(
  "watches active source and excludes children from a %s root",
  async (location) => {
    const ownerRoot = await mkdtemp(path.join(tmpdir(), "kossilon-dev-watch-"));
    const root =
      location === "nested"
        ? path.join(ownerRoot, ".worktrees", "active-checkout")
        : location === "glob characters"
          ? path.join(ownerRoot, "project (copy) [draft] {a,b} + @tag!")
          : ownerRoot;
    let server: ViteDevServer | undefined;
    try {
      const activeDirectory = path.join(root, "src");
      const otherDirectory = path.join(root, ".worktrees", "other-branch", "src");
      const activeFile = path.join(activeDirectory, "active.ts");
      const otherFile = path.join(otherDirectory, "foreign.ts");
      await mkdir(activeDirectory, { recursive: true });
      await mkdir(otherDirectory, { recursive: true });
      await writeFile(activeFile, "export const active = 1;\n");
      await writeFile(otherFile, "export const foreign = 1;\n");
      const resolved = await projectConfig({ command: "serve", mode: "development" });
      server = await createServer({
        root,
        configFile: false,
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true },
        plugins: resolved.plugins.filter(
          (plugin) => plugin.name === "kossilon:exclude-other-worktrees",
        ),
        server: { middlewareMode: true, watch: resolved.server?.watch },
      });
      const watcher = server.watcher;
      const normalize = (value: string) => value.replaceAll("\\", "/");
      await vi.waitFor(() => {
        expect(Object.keys(watcher.getWatched()).map(normalize)).toContain(
          normalize(activeDirectory),
        );
      });
      expect(
        Object.keys(watcher.getWatched()).filter((directory) =>
          normalize(directory).startsWith(`${normalize(path.join(root, ".worktrees"))}/`),
        ),
      ).toEqual([]);

      const changes: string[] = [];
      watcher.on("change", (filename) => changes.push(normalize(filename)));
      await writeFile(otherFile, "export const foreign = 2;\n");
      await writeFile(activeFile, "export const active = 2;\n");
      await vi.waitFor(() => expect(changes).toContain(normalize(activeFile)), { timeout: 5_000 });
      expect(changes).not.toContain(normalize(otherFile));
    } finally {
      await server?.close();
      await removeOwnedFixture(ownerRoot);
    }
  },
);
