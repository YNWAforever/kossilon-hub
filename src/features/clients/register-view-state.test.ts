import { defaultParseSearch } from "@tanstack/react-router";
import { expect, it } from "vitest";
import {
  clientRegisterSearch,
  clientRegisterReturnPath,
  clientDetailSearch,
} from "./register-view-state";
const id = "11111111-1111-4111-8111-111111111111";
it("round-trips JSON-shaped search strings and tuple cursors using router serialization", () => {
  const search = clientRegisterSearch({
    q: "12345",
    status: "inactive",
    team: id,
    includeFixtures: true,
    cursor: JSON.stringify(["中文公司", id]),
  });
  const path = clientRegisterReturnPath(search);
  expect(clientRegisterSearch(defaultParseSearch(path.slice(path.indexOf("?"))))).toEqual({
    q: "12345",
    status: "inactive",
    team: id,
    includeFixtures: true,
    cursor: '["中文公司","11111111-1111-4111-8111-111111111111"]',
  });
});
it("uses narrow defaults and excludes snapshots or unknown parameters from return paths", () => {
  const search = clientRegisterSearch({ snapshot: "synthetic-secret", token: "synthetic-token" });
  expect(search).toEqual({ q: "", status: "all", team: "all", includeFixtures: false });
  expect(clientRegisterReturnPath(search)).not.toMatch(/snapshot|token|secret/);
});
it.each([
  { q: ["a", "b"] },
  { q: 12 },
  { status: ["active", "inactive"] },
  { status: "unknown" },
  { team: [id] },
  { team: "invalid" },
  { includeFixtures: [true, false] },
  { includeFixtures: "yes" },
  { cursor: ["a", id] },
  { cursor: "not-json" },
  { cursor: "[]" },
  { cursor: JSON.stringify(["Company", "bad-id"]) },
  { q: "x".repeat(201) },
  { cursor: "x".repeat(2049) },
])("rejects invalid or repeated URL fields instead of broadening the read: %s", (input) => {
  expect(() => clientRegisterSearch(input)).toThrow();
});
it.each([
  undefined,
  null,
  ["/clients", "//evil.example"],
  "https://evil.example",
  "//evil.example",
  "/clients-other",
  "/clients/../outside",
  "/\\evil.example",
  "/clients\n?x=y",
])("uses /clients fallback for unsafe returnTo: %s", (returnTo) => {
  expect(clientDetailSearch({ returnTo })).toEqual({ returnTo: "/clients" });
});
it("preserves an allowed same-site clients return path", () => {
  expect(clientDetailSearch({ returnTo: "/clients?q=Acme&status=inactive" })).toEqual({
    returnTo: "/clients?q=Acme&status=inactive",
  });
});
