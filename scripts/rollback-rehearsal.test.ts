import { describe, expect, it } from "vitest";

import { runRehearsalChecks, selectRollbackCandidate, type Deployment } from "./rollback-rehearsal";

const current: Deployment = {
  uid: "dpl_current",
  url: "current.vercel.app",
  state: "READY",
  target: "production",
  created: 2_000,
  meta: { githubCommitSha: "a".repeat(40) },
};
const earlier: Deployment = {
  uid: "dpl_earlier",
  url: "earlier.vercel.app",
  state: "READY",
  target: "production",
  created: 1_000,
  meta: { githubCommitSha: "b".repeat(40) },
};

describe("rollback rehearsal", () => {
  it("picks the newest earlier READY production deployment, not the current one", () => {
    const newerButCurrent = { ...current };
    const olderCandidate = { ...earlier, created: 900 };
    const newestEarlier = { ...earlier, uid: "dpl_earlier_new", created: 1_500 };

    expect(
      selectRollbackCandidate(
        [newerButCurrent, olderCandidate, newestEarlier, { ...earlier, state: "ERROR" }],
        current.meta!.githubCommitSha!,
      )?.uid,
    ).toBe("dpl_earlier_new");
  });

  it("returns null when the current deployment is not in the list", () => {
    expect(selectRollbackCandidate([earlier], "c".repeat(40))).toBeNull();
  });

  it("checks the candidate and the capability pause with a fake transport", async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/version"))
        return new Response(JSON.stringify({ sha: earlier.meta!.githubCommitSha }), {
          status: 200,
        });
      if (url.endsWith("/api/health"))
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url.endsWith("/login"))
        return new Response("<html>", {
          status: 200,
          headers: {
            "x-content-type-options": "nosniff",
            "content-security-policy-report-only": "default-src 'self'",
          },
        });
      if (url.endsWith("/request-access"))
        return new Response('<a href="mailto:admin@example.test">email</a>', { status: 200 });
      if (url.endsWith("/api/capabilities"))
        return new Response(
          JSON.stringify({ capabilities: [{ id: "firm" }, { id: "whatsapp" }] }),
          { status: 200 },
        );
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const checks = await runRehearsalChecks(fetcher, earlier, current.meta!.githubCommitSha!);

    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks.map((check) => check.name)).toEqual([
      "rollback-candidate-version",
      "rollback-candidate-health",
      "rollback-candidate-login-headers",
      "capability-pause-request-access",
      "capability-status-readable",
      "rehearsal-is-read-only",
    ]);
  });

  it("fails the pause check if a non-persisting form would render", async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/version"))
        return new Response(JSON.stringify({ sha: earlier.meta!.githubCommitSha }), {
          status: 200,
        });
      if (url.endsWith("/api/health"))
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url.endsWith("/login"))
        return new Response("<html>", {
          status: 200,
          headers: {
            "x-content-type-options": "nosniff",
            "content-security-policy-report-only": "default-src 'self'",
          },
        });
      if (url.endsWith("/request-access"))
        return new Response('<form><input name="request-access-name"></form>', { status: 200 });
      if (url.endsWith("/api/capabilities"))
        return new Response(
          JSON.stringify({ capabilities: [{ id: "firm" }, { id: "whatsapp" }] }),
          { status: 200 },
        );
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const checks = await runRehearsalChecks(fetcher, earlier, current.meta!.githubCommitSha!);
    expect(checks.find((check) => check.name === "capability-pause-request-access")?.ok).toBe(
      false,
    );
  });
});
