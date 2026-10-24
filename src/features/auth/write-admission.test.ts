import { describe, expect, it } from "vitest";
import { requireActor, requireStaffActor } from "./neon-auth-server";
import { schemaCatalogDouble } from "@/test/schema-catalog-double";
import { EXPECTED_MIGRATIONS } from "@/features/operations/schema-health";

const request = (method = "POST") => new Request("https://local.invalid/command", { method });
const auth = {
  getSession: async () => ({ user: { id: "synthetic-session", email: "unit@example.test" } }),
  signOut: async () => new Response(),
};
const faults = [
  "missing",
  "unknown",
  "same-count-diverged",
  "no-ledger",
  "empty-ledger",
  "marker",
  "index",
  "unreadable",
] as const;

describe("UC189 authenticated non-scheduled write admission (unit transport)", () => {
  it.each(["Staff", "Client"] as const)(
    "refuses %s before business writes for every schema fault and retry",
    async (role) => {
      for (const fault of faults) {
        const { state, sql } = schemaCatalogDouble(role);
        if (["missing", "same-count-diverged"].includes(fault))
          state.ledger.applied = EXPECTED_MIGRATIONS.slice(1);
        if (["unknown", "same-count-diverged"].includes(fault))
          state.ledger.applied = [...state.ledger.applied, "9999_uc189_unknown_ac7d801e.sql"];
        if (fault === "no-ledger") state.ledger = { present: false, applied: [] };
        if (fault === "empty-ledger") state.ledger.applied = [];
        if (fault === "marker") state.marker = false;
        if (fault === "index") state.index = false;
        if (fault === "unreadable") state.readFailure = true;
        let writes = 0;
        for (let n = 0; n < 2; n++) {
          await expect(
            requireActor(request(), { auth, sql }).then(() => {
              writes++;
            }),
          ).rejects.toMatchObject({ statusCode: 503, code: "SCHEMA_WRITE_BLOCKED" });
        }
        expect(writes).toBe(0);
        expect(state.queries.every((query) => !/^\s*(insert|update|delete)/i.test(query))).toBe(
          true,
        );
      }
    },
  );
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "checks %s without caching a previous successful admission",
    async (method) => {
      const { state, sql } = schemaCatalogDouble();
      expect((await requireActor(request(method), { auth, sql })).role).toBe("Staff");
      state.marker = false;
      await expect(requireActor(request(method), { auth, sql })).rejects.toMatchObject({
        statusCode: 503,
      });
    },
  );
  it.each(["GET", "HEAD", "OPTIONS"])(
    "keeps %s diagnostics available without schema admission",
    async (method) => {
      const { state, sql } = schemaCatalogDouble();
      state.readFailure = true;
      expect((await requireActor(request(method), { auth, sql })).active).toBe(true);
      expect(state.queries).toHaveLength(1);
    },
  );
  it("preserves unauthorized, inactive and unprovisioned denials before catalog access", async () => {
    for (const fault of ["no-session", "inactive", "unknown"]) {
      const { state, sql } = schemaCatalogDouble();
      state.readFailure = true;
      if (fault === "inactive") state.active = false;
      if (fault === "unknown") state.provisioned = false;
      await expect(
        requireActor(request(), {
          auth: fault === "no-session" ? { ...auth, getSession: async () => null } : auth,
          sql,
        }),
      ).rejects.toThrow(/Unauthorized:|Forbidden:/);
      expect(
        state.queries.every((query) => /staff_profiles|client_company_memberships/.test(query)),
      ).toBe(true);
    }
  });
  it("recovers after refusal, and retains Staff-only role denial", async () => {
    const { state, sql } = schemaCatalogDouble("Client");
    state.marker = false;
    await expect(requireActor(request(), { auth, sql })).rejects.toMatchObject({ statusCode: 503 });
    state.marker = true;
    expect((await requireActor(request(), { auth, sql })).role).toBe("Client");
    await expect(requireStaffActor(request(), { auth, sql })).rejects.toThrow(/^Forbidden:/);
  });
});
