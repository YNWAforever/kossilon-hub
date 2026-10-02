import { expect, it } from "vitest";
import { auditStagingTarget } from "./audit-staging-config";
it("fails closed before opening a browser with missing runtime authority or credentials", () => {
  expect(() => auditStagingTarget({})).toThrow(/AUDIT_STAGING_ORIGIN/);
  expect(() =>
    auditStagingTarget({ AUDIT_STAGING_ORIGIN: "https://kossilon-hub.vercel.app" }),
  ).toThrow(/production/);
  expect(() =>
    auditStagingTarget({
      AUDIT_STAGING_ORIGIN: "https://controlled-staging.example.test",
      AUDIT_STAGING_ISOLATED: "true",
      AUDIT_STAGING_RELEASE_SHA: "a".repeat(40),
      AUDIT_STAGING_APPROVAL_REF: "controlled test account approval",
    }),
  ).toThrow(/AUDIT_ADMIN_EMAIL/);
});
it("allows only an explicit isolated origin and five approved fresh test accounts without printing values", () => {
  const env: Record<string, string> = {
    AUDIT_STAGING_ORIGIN: "https://controlled-staging.example.test",
    AUDIT_STAGING_ISOLATED: "true",
    AUDIT_STAGING_RELEASE_SHA: "a".repeat(40),
    AUDIT_STAGING_APPROVAL_REF: "owner-approved controlled test accounts",
  };
  for (const role of ["ADMIN", "MANAGER", "STAFF", "CLIENT_A", "CLIENT_B"]) {
    env[`AUDIT_${role}_EMAIL`] = `${role.toLowerCase()}@example.test`;
    env[`AUDIT_${role}_PASSWORD`] = "DO_NOT_PRINT_CONTROLLED_SECRET";
  }
  const target = auditStagingTarget(env);
  expect(target).toEqual({
    origin: env.AUDIT_STAGING_ORIGIN,
    buildSha: env.AUDIT_STAGING_RELEASE_SHA,
  });
  expect(JSON.stringify(target)).not.toContain("SECRET");
  expect(() =>
    auditStagingTarget({
      ...env,
      AUDIT_STAGING_ORIGIN: "https://controlled-staging.example.test/path",
    }),
  ).toThrow(/origin/);
});
