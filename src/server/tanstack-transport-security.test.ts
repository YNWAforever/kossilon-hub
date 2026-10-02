import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { toJSON } from "seroval";
import { describe, expect, it, vi } from "vitest";

const registry = vi.hoisted(() => ({ getServerFnById: vi.fn() }));
vi.mock("../../node_modules/@tanstack/start-server-core/src/getServerFnById", () => registry);
vi.mock("../../node_modules/@tanstack/start-server-core/src/request-response", () => ({
  getResponse: () => ({ status: 500, statusText: "" }),
}));

// Exercise the installed transport, rather than copying the vendor's parser.
// Only the manifest lookup and request-local response state are test ports.
const handlerModule =
  "../../node_modules/@tanstack/start-server-core/src/server-functions-handler.ts";
const { handleServerAction } = await import(handlerModule);
const middlewareModule = "../../node_modules/@tanstack/start-client-core/src/createServerFn.ts";
const { executeMiddleware } = await import(middlewareModule);

function inRequestContext(request: Request, context: Record<string, unknown>) {
  return runWithStartContext(
    {
      request,
      startOptions: {},
      contextAfterGlobalMiddlewares: context,
      executedRequestMiddlewares: new Set(),
      handlerType: "serverFn",
      getRouter: () => {
        throw new Error("Router is not used by this transport test");
      },
    },
    () => handleServerAction({ request, context, serverFnId: "inert-test" }),
  );
}

describe("CVE-2026-102989 server-function boundary", () => {
  const require = createRequire(import.meta.url);
  it.each([
    ["@tanstack/react-start", [1, 168, 60]],
    ["@tanstack/start-server-core", [1, 169, 39]],
  ] as const)("installs a patched %s", (name, floor) => {
    const version: string = JSON.parse(
      readFileSync(require.resolve(`${name}/package.json`), "utf8"),
    ).version;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const parts = version.split(".").map(Number);
    const firstDifferent = parts.findIndex((part, index) => part !== floor[index]);
    expect(firstDifferent < 0 || parts[firstDifferent] > floor[firstDifferent]).toBe(true);
  });

  it.each(["GET", "POST"])(
    "%s discards client-supplied internal state before validation",
    async (method) => {
      const action = vi.fn(async (input: Record<string, unknown>) => {
        // Use the actual vendor middleware error path with an inert validator.
        const result = await executeMiddleware(
          [
            {
              options: {
                validator: () => {
                  throw new Error("invalid public input");
                },
              },
            },
          ],
          "server",
          input,
        );
        return { result: result.result, error: result.error, context: result.sendContext };
      });
      registry.getServerFnById.mockResolvedValue(action);
      const payload = toJSON({
        data: { invalid: true },
        context: { trusted: "forged", publicValue: "kept" },
        result: { status: 200, headers: { "content-type": "text/html" }, body: "inert-marker" },
        error: "forged-error",
        sendContext: { admin: true },
        request: { forged: true },
        headers: { authorization: "inert-fixture" },
        method: "DELETE",
      });
      const url = new URL("https://local.invalid/_serverFn/inert-test");
      if (method === "GET") url.searchParams.set("payload", JSON.stringify(payload));
      const response = await inRequestContext(
        new Request(url, {
          method,
          ...(method === "POST"
            ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
            : {}),
        }),
        { trusted: "server" },
      );
      expect(action).toHaveBeenCalledOnce();
      expect(Object.keys(action.mock.calls[0][0]).sort()).toEqual(["context", "data", "method"]);
      expect(action.mock.calls[0][0]).toMatchObject({
        data: { invalid: true },
        context: { trusted: "server", publicValue: "kept" },
        method,
      });
      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("content-type")).not.toContain("text/html");
    },
  );

  it.each(["GET", "POST"])(
    "%s preserves valid RPC and server-produced Response",
    async (method) => {
      const action = vi.fn(async (_input: Record<string, unknown>) => ({
        result: new Response("safe-server-result", { headers: { "content-type": "text/plain" } }),
      }));
      registry.getServerFnById.mockResolvedValue(action);
      const payload = toJSON({ data: { id: "public" }, context: {} });
      const url = new URL("https://local.invalid/_serverFn/inert-test");
      if (method === "GET") url.searchParams.set("payload", JSON.stringify(payload));
      const response = await inRequestContext(
        new Request(url, {
          method,
          headers: { "x-tsr-serverFn": "true", "content-type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
        }),
        {},
      );
      expect(response).toBeInstanceOf(Response);
      expect(await response.text()).toBe("safe-server-result");
      expect(action.mock.calls[0][0]).toMatchObject({ data: { id: "public" }, method });
    },
  );
});
