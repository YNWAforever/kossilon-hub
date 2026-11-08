import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_RECORD_NOTE,
  mergeDeploymentRecords,
  toRecordedDeployment,
  type RecordedDeployment,
} from "./deployment-record";

function record(overrides: Partial<RecordedDeployment> = {}): RecordedDeployment {
  return {
    deploymentId: "dpl_1",
    sha: "a".repeat(40),
    environment: "production",
    host: "https://kossilon-hub.vercel.app",
    state: "READY",
    createdAt: "2026-11-09T01:00:00.000Z",
    verified: null,
    ...overrides,
  };
}

describe("deployment record", () => {
  it("maps a Vercel deployment to a record", () => {
    expect(
      toRecordedDeployment({
        uid: "dpl_1",
        url: "kossilon-abc.vercel.app",
        readyState: "READY",
        target: "production",
        createdAt: Date.parse("2026-11-09T03:00:00.000Z"),
        alias: ["kossilon-hub.vercel.app"],
        meta: { githubCommitSha: "b".repeat(40), githubCommitRef: "main" },
      }),
    ).toEqual({
      deploymentId: "dpl_1",
      sha: "b".repeat(40),
      environment: "production",
      host: "https://kossilon-hub.vercel.app",
      state: "READY",
      createdAt: "2026-11-09T03:00:00.000Z",
      verified: null,
    });
  });

  it("keeps manual verification when a refresh arrives", () => {
    const existing = [
      record({
        deploymentId: "dpl_new",
        createdAt: "2026-11-09T02:00:00.000Z",
        verified: "receipt 31",
      }),
    ];
    const fetched = [
      record({ deploymentId: "dpl_new", createdAt: "2026-11-09T02:00:00.000Z", verified: null }),
    ];

    const merged = mergeDeploymentRecords(existing, fetched);
    expect(merged).toHaveLength(1);
    expect(merged[0].verified).toBe("receipt 31");
  });

  it("counts platform facts as fresher than the file", () => {
    const merged = mergeDeploymentRecords(
      [record({ state: "BUILDING" })],
      [record({ state: "READY" })],
    );

    expect(merged[0].state).toBe("READY");
  });

  it("keeps older entries the deployment listing no longer returns, newest first", () => {
    const merged = mergeDeploymentRecords(
      [record({ deploymentId: "dpl_old", createdAt: "2026-10-01T00:00:00.000Z" })],
      [record({ deploymentId: "dpl_new", createdAt: "2026-11-09T03:00:00.000Z" })],
    );

    expect(merged.map((item) => item.deploymentId)).toEqual(["dpl_new", "dpl_old"]);
  });

  it("caps the record but the note explains how it is maintained", () => {
    const merged = mergeDeploymentRecords(
      [],
      Array.from({ length: 5 }, (_, index) =>
        record({
          deploymentId: `dpl_${index}`,
          createdAt: new Date(Date.UTC(2026, 10, 9, index)).toISOString(),
        }),
      ),
      3,
    );

    expect(merged).toHaveLength(3);
    expect(DEPLOYMENT_RECORD_NOTE).toContain("scripts/record-deployment.ts");
  });
});
