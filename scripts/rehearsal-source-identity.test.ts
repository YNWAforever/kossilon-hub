import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  captureRehearsalSourceIdentity,
  assertRehearsalSourceUnchanged,
} from "./rehearsal-source-identity";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kossilon-source-identity-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.email", "source-identity@example.test");
  git("config", "user.name", "Isolated contract");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(root, "execute.ts"), "abc");
  git("add", "execute.ts");
  git("commit", "-qm", "synthetic source");
  return { root, git };
}
const capture = (root: string, files = ["execute.ts"]) => {
  return captureRehearsalSourceIdentity(root, files);
};

it("records the actual full Git revision/tree and byte hash independently of historical provenance", () => {
  const { root, git } = fixture();
  const identity = capture(root);
  expect(identity.git).toEqual({
    commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    worktree_clean: true,
  });
  expect(identity.source_files).toEqual({
    "execute.ts": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  });
  expect(identity.runtime).toEqual({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  });
});

it("hashes staged, unstaged and untracked executing bytes instead of labelling HEAD bytes as executed", () => {
  const { root, git } = fixture();
  writeFileSync(join(root, "execute.ts"), "staged");
  git("add", "execute.ts");
  writeFileSync(join(root, "execute.ts"), "abc");
  writeFileSync(join(root, "new.ts"), "abc");
  const identity = capture(root, ["execute.ts", "new.ts"]);
  expect(identity.git.worktree_clean).toBe(false);
  expect(identity.source_files).toEqual({
    "execute.ts": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "new.ts": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  });
});

it("refuses a success receipt when executing source bytes change during the run", () => {
  const { root } = fixture();
  const before = capture(root);
  writeFileSync(join(root, "execute.ts"), "changed");
  expect(() => assertRehearsalSourceUnchanged(before, capture(root))).toThrow(/source.*changed/i);
});

it("refuses a success receipt when HEAD changes even if the selected bytes stay identical", () => {
  const { root, git } = fixture();
  const before = capture(root);
  git("commit", "--allow-empty", "-qm", "new executing revision");
  expect(() => assertRehearsalSourceUnchanged(before, capture(root))).toThrow(/source.*changed/i);
});

it("allows unrelated evidence output while preserving the original execution snapshot", () => {
  const { root } = fixture();
  const before = capture(root);
  writeFileSync(join(root, "generated-receipt.json"), "{}");
  const after = capture(root);
  expect(after.git.worktree_clean).toBe(false);
  expect(() => assertRehearsalSourceUnchanged(before, after)).not.toThrow();
  expect(before.git.worktree_clean).toBe(true);
});

it("refuses empty, missing or outside-worktree execution input inventories", () => {
  const { root } = fixture();
  const outside = join(fixture().root, "execute.ts");
  expect(() => captureRehearsalSourceIdentity(root, [])).toThrow(/must not be empty/);
  expect(() => captureRehearsalSourceIdentity(root, ["missing.ts"])).toThrow(/ENOENT/);
  expect(() => captureRehearsalSourceIdentity(root, [relative(root, outside)])).toThrow(
    /inside the worktree/,
  );
  expect(() => captureRehearsalSourceIdentity(root, [outside])).toThrow(/inside the worktree/);
});
