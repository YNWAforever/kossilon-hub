import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { clientCaseReturnPath } from "./client-return-context";
import { caseReturnPath } from "@/features/annual-return/daily-view-state";

describe("client case return context", () => {
  it.each(["10000000-0000-0000-0000-000000000001", "ABCDEF00-0000-0000-0000-000000000001"])(
    "preserves the exact validated client identity %s and encoded register context",
    (id) => {
      const register =
        "/clients?q=%E4%B8%AD%E6%96%87%20Acme&status=inactive&cursor=%22%5B%5C%22Acme%5C%22%2C%5C%2210000000-0000-0000-0000-000000000001%5C%22%5D%22";
      const result = new URL(clientCaseReturnPath(id, register), "https://example.test");
      expect(result.pathname).toBe(`/clients/${id}`);
      expect(defaultParseSearch(result.search)).toMatchObject({ returnTo: register });
    },
  );
  it.each([
    undefined,
    null,
    ["10000000-0000-0000-0000-000000000001"],
    "bad-id",
    "10000000-0000-0000-0000-000000000001/foreign",
    "10000000-0000-0000-0000-000000000001?returnTo=//foreign.example",
  ])("does not construct a client detail path from malformed identity %j", (id) => {
    expect(clientCaseReturnPath(id, "/clients?q=Acme")).toBe("/clients");
  });
  it.each([
    undefined,
    ["/clients", "/work-queue"],
    "https://foreign.example/clients",
    "//foreign.example",
    "/clients-other",
    "/clients/../outside",
  ])("uses a safe register fallback for %j", (returnTo) => {
    const result = new URL(
      clientCaseReturnPath("10000000-0000-0000-0000-000000000001", returnTo),
      "https://example.test",
    );
    expect(defaultParseSearch(result.search)).toMatchObject({ returnTo: "/clients" });
  });
});

describe("shared case return boundary for exact client detail paths", () => {
  it.each([
    "/clients/10000000-0000-0000-0000-000000000001",
    "/clients/10000000-0000-0000-0000-000000000001?returnTo=%2Fclients%3Fq%3D12345%26status%3Dinactive",
  ])("retains a validated exact detail path and its query: %s", (path) => {
    expect(caseReturnPath(path)).toBe(path);
  });
  it.each([
    undefined,
    null,
    ["/clients/10000000-0000-0000-0000-000000000001"],
    "https://foreign.example/clients/10000000-0000-0000-0000-000000000001",
    "//foreign.example/clients/10000000-0000-0000-0000-000000000001",
    "/clients/not-a-uuid",
    "/clients/10000000-0000-0000-0000-000000000001/",
    "/clients/10000000-0000-0000-0000-000000000001/foreign",
    "/clients/10000000-0000-0000-0000-000000000001/../foreign",
    "/clients/10000000-0000-0000-0000-000000000001%2Fforeign",
    "/clients/10000000-0000-0000-0000-000000000001-extra",
    "/clients//10000000-0000-0000-0000-000000000001",
    "/clients-other/10000000-0000-0000-0000-000000000001",
    "/clients/10000000-0000-0000-0000-000000000001\n?returnTo=/clients",
  ])("does not widen the allowlist for malformed or foreign input %j", (path) => {
    expect(caseReturnPath(path)).toBe("/annual-returns");
  });
});
