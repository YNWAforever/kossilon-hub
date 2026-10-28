/* Offline handler-wiring regression. Run: node --test this-file.cjs
 * Set KOSSILON_REPO to an npm-installed checkout. No network/database is used.
 * Executes actual TypeScript handlers after transpilation; mocks only request,
 * server-function transport and repository IO. Not an HTTP/RLS acceptance test.
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const repo = process.env.KOSSILON_REPO || process.cwd();
const projectRequire = createRequire(path.join(repo, "package.json"));
const ts = projectRequire("typescript");
const a = { authUserId: "auth-a", userId: "user-a", role: "Staff", teamId: "team-a", active: true };
const rows = [
  { id: "11111111-1111-4111-8111-111111111111", teamId: "team-a" },
  { id: "22222222-2222-4222-8222-222222222222", teamId: "team-b" },
];

function sourceLoader(actor, repositoryOverrides = {}) {
  const cache = new Map();
  const repository = {
    listCases: async (scope) =>
      scope?.teamId ? rows.filter((r) => r.teamId === scope.teamId) : rows,
    getCase: async (id) => rows.find((r) => r.id === id) ?? null,
    getCaseTeamId: async (id) => rows.find((r) => r.id === id)?.teamId ?? null,
    close: async () => {},
    ...repositoryOverrides,
  };
  function load(filename) {
    if (!path.extname(filename)) filename += ".ts";
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const source = fs.readFileSync(filename, "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (id) => {
      if (id === "@tanstack/react-start")
        return {
          createServerOnlyFn: (fn) => fn,
          createServerFn: () => {
            let schema;
            const builder = {
              validator: (s) => {
                schema = s;
                return builder;
              },
              handler:
                (fn) =>
                async (input = {}) =>
                  fn({ data: schema ? schema.parse(input.data) : input.data }),
            };
            return builder;
          },
        };
      if (id === "@tanstack/react-start/server")
        return { getRequest: () => new Request("http://localhost/audit") };
      if (id === "@/features/auth/neon-auth-server")
        return { requireStaffActor: async () => actor };
      if (
        id === "./repository" &&
        filename.split(path.sep).join("/").endsWith("/incorporation/server-fns.ts")
      )
        return { createIncorporationRepository: () => repository };
      if (id === "@/server/db/client")
        throw new Error("R14 unit harness must not load a real DB client");
      if (id.startsWith("@/")) return load(path.join(repo, "src", id.slice(2)));
      if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), id));
      return projectRequire(id);
    };
    vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })(
      localRequire,
      mod,
      mod.exports,
    );
    return mod.exports;
  }
  return (rel) => load(path.join(repo, rel));
}

test("F16 / UC102: staff listing never contains another team", async () => {
  const api = sourceLoader(a)("src/features/incorporation/server-fns.ts");
  const result = await api.listIncorporationCases();
  assert.deepEqual(
    result.map((r) => r.teamId),
    ["team-a"],
  );
});
test("F16 / UC103: staff cannot read another team incorporation detail", async () => {
  const api = sourceLoader(a)("src/features/incorporation/server-fns.ts");
  await assert.rejects(() => api.getIncorporationCase({ data: { id: rows[1].id } }), /Forbidden/);
});
test("F16 / UC104: staff with no team must fail closed on list", async () => {
  const api = sourceLoader({ ...a, teamId: null })("src/features/incorporation/server-fns.ts");
  await assert.rejects(() => api.listIncorporationCases(), /Forbidden/);
});
test("UC105: Admin may read the multi-team incorporation register", async () => {
  const api = sourceLoader({ ...a, role: "Admin", teamId: null })(
    "src/features/incorporation/server-fns.ts",
  );
  assert.equal((await api.listIncorporationCases()).length, 2);
});
test("UC106: corporate change detail rejects another team (positive control)", async () => {
  const api = sourceLoader(a)("src/features/corporate-changes/read.ts");
  await assert.rejects(
    () =>
      api.getCorporateChangeRequestForActor(a, rows[1].id, {
        repository: {
          getRequest: async () => ({ id: rows[1].id, companyId: "company-b" }),
          getCompanyTeamId: async () => "team-b",
        },
      }),
    /Forbidden/,
  );
});
test("UC107: corporate change no-team list fails closed (positive control)", () => {
  const api = sourceLoader(a)("src/features/corporate-changes/read.ts");
  assert.throws(() => api.corporateChangeListTeamScope({ ...a, teamId: null }), /Forbidden/);
});

for (const role of ["Staff", "Manager"]) {
  for (const teamId of ["team-a", "team-b"]) {
    test(`${role} ${teamId}: list and detail share the assigned-team boundary`, async () => {
      const api = sourceLoader({ ...a, role, teamId })("src/features/incorporation/server-fns.ts");
      const own = rows.find((row) => row.teamId === teamId);
      const other = rows.find((row) => row.teamId !== teamId);
      assert.deepEqual(
        (await api.listIncorporationCases()).map((row) => row.id),
        [own.id],
      );
      assert.equal((await api.getIncorporationCase({ data: { id: own.id } })).id, own.id);
      await assert.rejects(() => api.getIncorporationCase({ data: { id: other.id } }), /Forbidden/);
    });
  }
}

for (const overrides of [
  { role: "Staff", teamId: null },
  { role: "Manager", teamId: null },
  { role: "Client" },
  { role: "Staff", active: false },
  { role: "Manager", active: false },
  { role: "Admin", active: false },
]) {
  test(`invalid actor ${JSON.stringify(overrides)}: both read handlers fail closed`, async () => {
    const api = sourceLoader({ ...a, ...overrides })("src/features/incorporation/server-fns.ts");
    await assert.rejects(() => api.listIncorporationCases(), /Forbidden/);
    await assert.rejects(() => api.getIncorporationCase({ data: { id: rows[0].id } }), /Forbidden/);
  });
}

test("Admin detail permits another team and a missing case remains null", async () => {
  const api = sourceLoader({ ...a, role: "Admin", teamId: null })(
    "src/features/incorporation/server-fns.ts",
  );
  assert.equal((await api.getIncorporationCase({ data: { id: rows[1].id } })).id, rows[1].id);
  assert.equal(
    await api.getIncorporationCase({ data: { id: "33333333-3333-4333-8333-333333333333" } }),
    null,
  );
});

test("search/page handler forwards only validated filters with the authenticated scope", async () => {
  const calls = [];
  const api = sourceLoader(a, {
    listCases: async (scope, query) => {
      calls.push({ scope, query });
      return rows.filter((row) => row.teamId === scope.teamId);
    },
  })("src/features/incorporation/server-fns.ts");
  const ownerId = "44444444-4444-4444-8444-444444444444";
  assert.deepEqual(
    (
      await api.listIncorporationCases({ data: { q: " 新創 ", ownerId, limit: 10, offset: 20 } })
    ).map((row) => row.id),
    [rows[0].id],
  );
  assert.deepEqual(calls, [
    {
      scope: { kind: "team", teamId: "team-a" },
      query: { q: "新創", ownerId, limit: 10, offset: 20 },
    },
  ]);
});

test("Admin explicitly narrows the list to a requested team", async () => {
  const teamId = "55555555-5555-4555-8555-555555555555";
  const calls = [];
  const api = sourceLoader(
    { ...a, role: "Admin", teamId: null },
    {
      listCases: async (scope) => {
        calls.push(scope);
        return [];
      },
    },
  )("src/features/incorporation/server-fns.ts");
  await api.listIncorporationCases({ data: { teamId } });
  assert.deepEqual(calls, [{ kind: "team", teamId }]);
});

test("owner/page filters cannot grant access to a foreign team", async () => {
  const api = sourceLoader(a)("src/features/incorporation/server-fns.ts");
  await assert.rejects(
    () =>
      api.listIncorporationCases({
        data: {
          teamId: "55555555-5555-4555-8555-555555555555",
          ownerId: "44444444-4444-4444-8444-444444444444",
          limit: 10,
          offset: 20,
        },
      }),
    /Forbidden/,
  );
});

test("list rejects an unrecognized scope override and invalid page bounds", async () => {
  const api = sourceLoader(a)("src/features/incorporation/server-fns.ts");
  for (const data of [{ scope: { kind: "all" } }, { limit: 0 }, { limit: 501 }, { offset: -1 }]) {
    await assert.rejects(() => api.listIncorporationCases({ data }));
  }
});
