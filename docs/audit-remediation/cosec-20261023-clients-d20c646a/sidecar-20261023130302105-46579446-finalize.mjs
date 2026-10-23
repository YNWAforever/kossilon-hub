import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
assert.equal(process.cwd(), root);
const folder = import.meta.dirname;
const stem = "sidecar-20261023130302105-46579446";
const files = ["src/components/clients/client-form-dialog.tsx", "src/components/clients/client-form-dialog.test.tsx"];
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const read = (suffix) => JSON.parse(readFileSync(join(folder, stem + "-" + suffix + ".json"), "utf8"));
const save = (suffix, data) => writeFileSync(join(folder, stem + "-" + suffix), data, {flag:"wx"});
const green = read("green-assignment-final");
const lint = read("lint-assignment-final");
const snapshots = read("snapshot-final");
assert.equal(green.exit_code, 0); assert.equal(green.counts.passed, 25);
assert.equal(green.counts.failed, 0); assert.equal(lint.exit_code, 0);
for (const f of files) {
  const current = hash(join(root, f));
  assert.equal(current, green.before[f]);
  assert.equal(current, green.after[f]);
  assert.equal(current, lint.before[f]);
  assert.equal(current, lint.after[f]);
  assert.equal(current, snapshots.fingerprints[f]);
  assert.equal(current, hash(join(folder, stem + "-snapshot-final-" + f.split("/").at(-1) + ".snapshot")));
}
const keep = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.test(key)));
env.NO_COLOR = "1"; env.CI = "true";
const git = (args) => spawnSync("git", args, {cwd:root, env, encoding:"utf8", windowsHide:true});
const checkArgs = ["diff", "--check", "--", ...files];
const check = git(checkArgs);
save("diff-check.log", (check.stdout ?? "") + (check.stderr ?? ""));
save("diff-check.json", JSON.stringify({command:["git",...checkArgs],exit_code:check.status,at:new Date().toISOString()},null,2));
assert.equal(check.status,0);
const diff = git(["diff", "--no-ext-diff", "--", ...files]); assert.equal(diff.status,0);
save("scoped-diff.patch", diff.stdout);
const summary = {
  status:"FROZEN_COMPONENT_ONLY_PASS", no_more_source_or_test_edits:true, frozen_at:new Date().toISOString(),
  root, head:snapshots.head, branch:snapshots.branch,
  owned_source_files:files, frozen_sha256:snapshots.fingerprints,
  source_snapshots:["snapshot-before","snapshot-prefixed-finalred","snapshot-assignment-gap-before","snapshot-assignment-gap-red","snapshot-final"],
  validation:[
    {receipt:stem+"-baseline.json",exit_code:1,total:0,note:"Harness EPERM before collection; original failure retained"},
    {receipt:stem+"-baseline-temp-local.json",exit_code:0,total:2,passed:2,failed:0},
    {receipt:stem+"-red.json",exit_code:1,total:21,passed:6,failed:15},
    {receipt:stem+"-red-rerender.json",exit_code:1,total:23,passed:5,failed:18},
    {receipt:stem+"-red-assignment-gap.json",exit_code:1,total:25,passed:22,failed:3},
    {receipt:stem+"-green-assignment-final.json",exit_code:0,total:25,passed:25,failed:0,pending:0},
    {receipt:stem+"-lint-assignment-final.json",exit_code:0,errors:0,warnings:0},
    {receipt:stem+"-diff-check.json",exit_code:0}
  ],
  acceptance:{
    UC135:"Required-field progression including owner/team, whitespace name/office and malformed CR then BR, associated text and exact-field focus, no RPC before valid. Empty assignments remain blank after options refresh until explicit selection; other draft inputs retained. Edit payload also requires owner/team under existing UUID schema.",
    UC136:"CR/BR server field rejection retains all 12 rendered inputs/selects plus default secretary in retried payload, focuses exact field, explicit manual correction, one pending retry, one successful callback/close.",
    UC137:"Whole-certificate BR with whitespace/lowercase accepted and passed through at mocked RPC boundary only; no assertion of real normalization.",
    recovery:"Same-render and pending duplicate form submissions guarded; pending cancel/Escape/Close guarded; ordinary cancel/reopen resets; generic/unknown/CR/BR/contact error recovery uses safe local messages; equivalent options/client rerenders preserve draft; edit identifiers/inactive assignments/payload preserved."
  },
  boundaries:{
    runtime:"Real React/Radix dialog in jsdom; only server functions and toast mocked. No real backend, DB/client/container/network/provider or authenticated HTTP/session runtime.",
    environment:"Child tests/lint use explicit OS-variable whitelist plus CI/NO_COLOR; no DB env; no non-example dotenv files present. Own runtime temp moved, after path inspection, into ignored .worktrees/"+stem+"-runtime-temp; no files deleted.",
    parent_owned:"No writes to backend/schema/SQL/registry or parent docs/evidence. Parent concurrent changes recorded in snapshot statuses. Full unit/typecheck/lint/build left for parent.",
    publication:"No commits, push, deploy, graph index or upload."
  },
  deficiencies:[
    "No real browser, session/HTTP, persistence, server normalization or SQL coverage claimed by this sidecar.",
    "Full-suite/typecheck/build not run by sidecar; parent will run them after this freeze.",
    "Existing vite-tsconfig-paths deprecation warnings appear in focused test logs.",
    "Initial sandbox TEMP rename EPERM resolved using local scoped temp and later relocated to ignored .worktrees.",
    "Two runner action labels (snapshot-red-rerender and format-assignment-gap) fell through to focused tests before dispatch was generalized; exact commands/results retained. They are redundant runs, not snapshots/format results. Correct snapshots and actual format receipts are separately present."
  ]
};
save("handoff.json",JSON.stringify(summary,null,2));
const artifacts = readdirSync(folder).filter((f)=>f.startsWith(stem+"-")).sort().map((f)=>({file:f,sha256:hash(join(folder,f))}));
save("frozen-manifest.json",JSON.stringify({at:new Date().toISOString(),head:snapshots.head,source_sha256:snapshots.fingerprints,artifacts},null,2));
console.log(JSON.stringify({status:summary.status,counts:green.counts,lint_exit:lint.exit_code,diff_check_exit:check.status,frozen_sha256:snapshots.fingerprints,handoff:join(folder,stem+"-handoff.json"),manifest:join(folder,stem+"-frozen-manifest.json"),artifact_count:artifacts.length,no_more_source_or_test_edits:true}));

