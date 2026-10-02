import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseEntityId } from "./entity-id";

describe("canonical Postgres entity IDs", () => {
  it.each([
    "40000000-0000-0000-0000-000000000001",
    "40000000-0000-0000-0000-000000000002",
    "40000000-0000-0000-0000-000000000003",
    "c5f247d0-f74f-46e6-a04b-331f0074de13",
    "C5F247D0-F74F-46E6-A04B-331F0074DE13",
  ])("accepts canonical DB ID %s without imposing UUID version/variant bits", (id) => {
    expect(parseEntityId(id)).toBe(id.toLowerCase());
    expect(z.string().uuid().safeParse(id).success).toBe(true);
  });
  it.each([
    undefined,
    null,
    0,
    {},
    [],
    "",
    "not-an-id",
    "40000000000000000000000000000002",
    " 40000000-0000-0000-0000-000000000002",
    "40000000-0000-0000-0000-00000000000g",
  ])("rejects noncanonical input %j", (value) => {
    expect(parseEntityId(value)).toBeNull();
  });
});
