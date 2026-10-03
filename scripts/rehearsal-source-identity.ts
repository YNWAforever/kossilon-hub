import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type RehearsalSourceIdentity = {
  algorithm: "sha256-raw-file-bytes-v1";
  git: { commit: string; tree: string; worktree_clean: boolean };
  source_files: Record<string, string>;
  runtime: { node: string; platform: string; arch: string };
};

/** Offline provenance only. Never an approval, deployed artifact or resolved SBOM. */
export function captureRehearsalSourceIdentity(
  root: string,
  files: string[],
): RehearsalSourceIdentity {
  const directory = realpathSync(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  assert.equal(realpathSync(git("rev-parse", "--show-toplevel")), directory);
  assert.ok(files.length > 0, "Execution input inventory must not be empty");
  const commit = git("rev-parse", "HEAD");
  const tree = git("rev-parse", "HEAD^{tree}");
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.match(tree, /^[a-f0-9]{40}$/);
  const source_files: Record<string, string> = {};
  for (const file of [...files].sort()) {
    assert.ok(!isAbsolute(file), "Execution inputs must stay inside the worktree");
    const absolute = realpathSync(resolve(directory, file));
    const path = relative(directory, absolute);
    assert.ok(
      path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path),
      "Execution inputs must stay inside the worktree",
    );
    const key = path.split(sep).join("/");
    assert.ok(!Object.hasOwn(source_files, key), "Duplicate execution input");
    source_files[key] = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  }
  assert.equal(git("rev-parse", "HEAD"), commit, "Execution source changed during capture");
  assert.equal(git("rev-parse", "HEAD^{tree}"), tree, "Execution source changed during capture");
  return {
    algorithm: "sha256-raw-file-bytes-v1",
    git: {
      commit,
      tree,
      worktree_clean: git("status", "--porcelain", "--untracked-files=normal") === "",
    },
    source_files,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
  };
}

export function assertRehearsalSourceUnchanged(
  before: RehearsalSourceIdentity,
  after: RehearsalSourceIdentity,
) {
  assert.ok(
    before.git.commit === after.git.commit &&
      before.git.tree === after.git.tree &&
      JSON.stringify(before.source_files) === JSON.stringify(after.source_files),
    "Execution source changed during rehearsal; refuse success receipt",
  );
}
